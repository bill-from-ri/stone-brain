import 'server-only'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { syncState, type CrawlCursor } from '@/db/schema'
import { DriveClient } from '@/lib/drive/client'
import { DriveAuthError } from '@/lib/google/errors'
import { crawlSubtree, emptyTally, type CrawlTally } from './crawl'
import { acquireLease, bumpSyncSeq, releaseLease, renewLease, type Lease } from './lease'
import { emptyResult, type SyncResult } from './result'
import { reconciliationSweep, recomputeTree } from './upsert'

/**
 * The one sync function. Idempotent, resumable, and reused unchanged by every
 * trigger — the manual button, the Library poller, and later any cron or webhook
 * (decisions §4).
 *
 * Two modes, chosen by whether a page token exists:
 *   A. initial crawl   — BFS from the root via files.list
 *   B. incremental      — the Drive Changes API (M7)
 */

/** Browser-triggered calls yield fast so the UI can show progress. */
export const BROWSER_BUDGET_MS = 45_000
/** Manual/background calls can use most of Vercel's 300s ceiling. */
export const BACKGROUND_BUDGET_MS = 240_000

export type SyncOptions = {
  budgetMs?: number
}

export async function syncRoot(userId: string, opts: SyncOptions = {}): Promise<SyncResult> {
  const startedAt = Date.now()
  const budgetMs = opts.budgetMs ?? BROWSER_BUDGET_MS
  const deadline = startedAt + budgetMs

  const lease = await acquireLease(userId)
  if (!lease) {
    // Someone else is syncing. Not an error — the poller shows "Syncing…".
    const result = emptyResult('noop')
    result.running = true
    result.complete = false
    result.durationMs = Date.now() - startedAt
    return result
  }

  try {
    const [state] = await db
      .select()
      .from(syncState)
      .where(eq(syncState.userId, userId))
      .limit(1)

    if (!state?.rootDriveFolderId) {
      const result = emptyResult('noop')
      result.error = { code: 'no_root_folder', message: 'No root folder has been chosen' }
      result.durationMs = Date.now() - startedAt
      return result
    }

    await db
      .update(syncState)
      .set({ lastSyncStartedAt: new Date(), lastSyncError: null })
      .where(eq(syncState.userId, userId))

    const client = await DriveClient.forUser(userId)

    const result =
      state.startPageToken === null
        ? await runInitialCrawl(client, state, deadline, lease)
        : await runIncremental(client, state, deadline)

    result.driveApiCalls = client.stats.apiCalls
    result.syncSeq = await bumpSyncSeq(userId)

    const [after] = await db
      .select({ completedAt: syncState.lastSyncCompletedAt })
      .from(syncState)
      .where(eq(syncState.userId, userId))
      .limit(1)
    result.lastSyncCompletedAt = after?.completedAt?.toISOString() ?? null
    result.durationMs = Date.now() - startedAt
    return result
  } catch (err) {
    // A dead Drive grant is a designed state, not a 500. Record it and return
    // it; /api/sync answers 200 and the UI renders the reconnect banner.
    if (err instanceof DriveAuthError) {
      const result = emptyResult('noop')
      result.tokenStatus = err.reason === 'revoked' ? 'revoked' : 'invalid_grant'
      result.complete = false
      result.error = { code: err.reason, message: err.message }
      result.durationMs = Date.now() - startedAt
      return result
    }

    const message = err instanceof Error ? err.message : 'Unknown sync failure'
    await db
      .update(syncState)
      .set({ lastSyncError: message })
      .where(eq(syncState.userId, userId))
      .catch(() => {})

    const result = emptyResult('noop')
    result.complete = false
    result.error = { code: 'sync_failed', message }
    result.durationMs = Date.now() - startedAt
    return result
  } finally {
    await releaseLease(userId, lease)
  }
}

/* ------------------------------------------------------------- Mode A */

type SyncStateRow = typeof syncState.$inferSelect

async function runInitialCrawl(
  client: DriveClient,
  state: SyncStateRow,
  deadline: number,
  lease: Lease,
): Promise<SyncResult> {
  const userId = client.userId
  const result = emptyResult('initial')

  /**
   * Capture the page token BEFORE enumerating anything.
   *
   * This is the single most important ordering rule in the whole sync. Any
   * change that happens during the crawl is then replayed by the first
   * incremental pass. Capturing it afterwards would silently and permanently
   * lose every change made while the crawl was running.
   */
  let pendingToken = state.pendingStartPageToken
  if (!pendingToken) {
    pendingToken = await client.getStartPageToken()
    await db
      .update(syncState)
      .set({ pendingStartPageToken: pendingToken })
      .where(eq(syncState.userId, userId))
  }

  const sweepId = state.sweepId ?? randomUUID()
  if (!state.sweepId) {
    await db.update(syncState).set({ sweepId }).where(eq(syncState.userId, userId))
  }

  const start: CrawlCursor = state.crawlCursor ?? {
    queue: [state.rootDriveFolderId!],
    pageToken: null,
  }

  const outcome = await crawlSubtree(client, start, {
    sweepId,
    deadline,
    onProgress: async (cursor) => {
      // Persist after every page so an invocation timeout resumes exactly here.
      await db
        .update(syncState)
        .set({ crawlCursor: cursor })
        .where(eq(syncState.userId, userId))
      // Keep the lease alive during a long crawl so a slow-but-healthy run
      // isn't taken over by the next poll tick.
      await renewLease(userId, lease)
    },
  })

  applyTally(result, outcome.tally)
  result.complete = outcome.complete

  if (!outcome.complete) {
    result.progress = {
      foldersVisited: outcome.tally.foldersVisited,
      documentsSeen: outcome.tally.documentsUpserted,
      queueRemaining: outcome.cursor?.queue.length ?? 0,
    }
    return result
  }

  // Crawl finished: promote the token in one transaction, then reconcile.
  await db
    .update(syncState)
    .set({
      startPageToken: pendingToken,
      pendingStartPageToken: null,
      initialCrawlDone: true,
      crawlCursor: null,
      lastSyncCompletedAt: new Date(),
    })
    .where(eq(syncState.userId, userId))

  const swept = await reconciliationSweep(userId, sweepId)
  result.foldersRemoved += swept.folders
  result.documentsRemoved += swept.documents

  await recomputeTree(userId)

  return result
}

/* ------------------------------------------------------------- Mode B */

async function runIncremental(
  _client: DriveClient,
  _state: SyncStateRow,
  _deadline: number,
): Promise<SyncResult> {
  // M7. The initial crawl already establishes start_page_token, so reaching
  // here before M7 lands simply means there is nothing to do yet.
  const result = emptyResult('incremental')
  result.complete = true
  await db
    .update(syncState)
    .set({ lastSyncCompletedAt: new Date() })
    .where(eq(syncState.userId, _client.userId))
  return result
}

function applyTally(result: SyncResult, tally: CrawlTally): void {
  result.foldersUpserted += tally.foldersUpserted
  result.documentsUpserted += tally.documentsUpserted
  result.documentsRestored += tally.documentsRestored
  result.skippedNonDocs += tally.skippedNonDocs
}

export { emptyTally }
