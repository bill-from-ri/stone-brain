import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { folders, syncState, type CrawlCursor } from '@/db/schema'
import { DriveClient } from '@/lib/drive/client'
import { DriveAuthError, DriveTransientError } from '@/lib/google/errors'
import { ScopeUndeterminedError } from '@/lib/drive/scope'
import type { DriveFile } from '@/lib/drive/types'
import { crawlSubtree, emptyTally, type CrawlTally } from './crawl'
import {
  classifyFileChange,
  classifyFolderChange,
  partitionChanges,
  type FileAction,
  type FolderAction,
} from './changes'
import { acquireLease, bumpSyncSeq, releaseLease, renewLease, type Lease } from './lease'
import { emptyResult, type SyncResult } from './result'
import {
  cascadeRemoveFolder,
  reconciliationSweep,
  recomputeTree,
  removeDocument,
  upsertDocument,
  upsertFolder,
} from './upsert'

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
        : await runIncremental(client, state, deadline, lease)

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
  client: DriveClient,
  state: SyncStateRow,
  deadline: number,
  lease: Lease,
): Promise<SyncResult> {
  const userId = client.userId
  const result = emptyResult('incremental')
  let token = state.startPageToken!

  while (true) {
    let page
    try {
      page = await client.listChanges(token)
    } catch (err) {
      if (isGonePageToken(err)) {
        // Drive expires page tokens that go unused long enough. Everything that
        // happened in the meantime is unknowable from the change feed, so fall
        // back to a full crawl plus a generation-stamped reconciliation sweep —
        // which is the only thing that can find deletions the feed never mentioned.
        await db
          .update(syncState)
          .set({
            startPageToken: null,
            pendingStartPageToken: null,
            initialCrawlDone: false,
            crawlCursor: null,
            sweepId: randomUUID(),
          })
          .where(eq(syncState.userId, userId))

        const [fresh] = await db
          .select()
          .from(syncState)
          .where(eq(syncState.userId, userId))
          .limit(1)
        return runInitialCrawl(client, fresh!, deadline, lease)
      }
      throw err
    }

    const { folderChanges, fileChanges, bareRemovals } = partitionChanges(page.changes ?? [])
    result.changesProcessed += (page.changes ?? []).length

    const subtreesToCrawl: string[] = []

    // Folders FIRST — see the note in partitionChanges. Scope verdicts are
    // resolved outside the transaction because they can hit the network.
    const folderPlans: { file: DriveFile; action: FolderAction }[] = []
    for (const { file } of folderChanges) {
      const wasKnown = await isLiveFolder(userId, file.id)
      let isInScope: boolean
      try {
        isInScope = (await client.scope.resolve({
          id: file.id,
          parents: file.parents,
          driveId: file.driveId,
        })) === 'in'
      } catch (err) {
        if (err instanceof ScopeUndeterminedError) {
          result.deferred.push({ id: file.id, reason: 'scope-undetermined' })
          continue
        }
        throw err
      }
      const action = classifyFolderChange({
        wasKnown,
        isInScope,
        removed: false,
        trashed: file.trashed ?? false,
      })
      folderPlans.push({ file, action })

      // Keep the resolver's view current before any file in this page is judged.
      if (action.kind === 'upsert' || action.kind === 'upsert-and-crawl') {
        client.scope.markInScope(file.id)
      } else if (action.kind === 'cascade-remove') {
        client.scope.markOutOfScope(file.id)
      }
    }

    const filePlans: { file: DriveFile; action: FileAction }[] = []
    for (const { file } of fileChanges) {
      let isInScope: boolean
      try {
        isInScope = (await client.scope.resolve({
          id: file.id,
          parents: file.parents,
          driveId: file.driveId,
        })) === 'in'
      } catch (err) {
        if (err instanceof ScopeUndeterminedError) {
          result.deferred.push({ id: file.id, reason: 'scope-undetermined' })
          continue
        }
        throw err
      }
      filePlans.push({
        file,
        action: classifyFileChange({
          mimeType: file.mimeType,
          isInScope,
          removed: false,
          trashed: file.trashed ?? false,
        }),
      })
    }

    const nextToken = page.nextPageToken ?? page.newStartPageToken ?? token

    /**
     * THE INVARIANT: the page token advances only inside the transaction that
     * commits that page's writes. Crash anywhere and you replay exactly one
     * page, which is safe because every write is an idempotent upsert and every
     * removal is idempotent. This one line of ordering discipline is the whole
     * of "idempotent and resumable".
     */
    await db.transaction(async (tx) => {
      for (const { file, action } of folderPlans) {
        if (action.kind === 'ignore') continue
        if (action.kind === 'cascade-remove') {
          const removed = await cascadeRemoveFolder(tx, userId, file.id)
          result.foldersRemoved += removed.folders
          result.documentsRemoved += removed.documents
          continue
        }
        await upsertFolder(tx, userId, file)
        result.foldersUpserted++
        if (action.kind === 'upsert-and-crawl') subtreesToCrawl.push(file.id)
      }

      for (const { file, action } of filePlans) {
        if (action.kind === 'ignore') {
          if (action.reason === 'not-a-doc') result.skippedNonDocs++
          continue
        }
        if (action.kind === 'remove') {
          if (await removeDocument(tx, userId, file.id)) result.documentsRemoved++
          continue
        }
        const { restored } = await upsertDocument(tx, userId, file)
        result.documentsUpserted++
        if (restored) result.documentsRestored++
      }

      // A bare removal has no payload, so we cannot tell a folder from a file.
      // Try both; each is a no-op if it does not match.
      for (const fileId of bareRemovals) {
        if (await isLiveFolder(userId, fileId)) {
          const removed = await cascadeRemoveFolder(tx, userId, fileId)
          result.foldersRemoved += removed.folders
          result.documentsRemoved += removed.documents
        } else if (await removeDocument(tx, userId, fileId)) {
          result.documentsRemoved++
        }
      }

      await tx
        .update(syncState)
        .set({ startPageToken: nextToken })
        .where(eq(syncState.userId, userId))
    })

    token = nextToken

    if (subtreesToCrawl.length > 0) {
      // Persisted, so an invocation timeout does not lose the work.
      const [row] = await db
        .select({ pending: syncState.pendingSubtreeCrawls })
        .from(syncState)
        .where(eq(syncState.userId, userId))
        .limit(1)
      const merged = Array.from(new Set([...(row?.pending ?? []), ...subtreesToCrawl]))
      await db
        .update(syncState)
        .set({ pendingSubtreeCrawls: merged })
        .where(eq(syncState.userId, userId))
    }

    await renewLease(userId, lease)

    if (!page.nextPageToken) break
    if (Date.now() > deadline) {
      result.complete = false
      return result
    }
  }

  // Drain any subtrees that moved into the root. Drive told us the folder
  // moved; it will never enumerate what is inside it.
  const drained = await drainPendingSubtrees(client, deadline)
  applyTally(result, drained.tally)
  if (!drained.complete) result.complete = false

  await recomputeTree(userId)
  await db
    .update(syncState)
    .set({ lastSyncCompletedAt: new Date() })
    .where(eq(syncState.userId, userId))

  return result
}

async function drainPendingSubtrees(
  client: DriveClient,
  deadline: number,
): Promise<{ tally: CrawlTally; complete: boolean }> {
  const userId = client.userId
  const tally = emptyTally()

  while (Date.now() < deadline) {
    const [row] = await db
      .select({ pending: syncState.pendingSubtreeCrawls })
      .from(syncState)
      .where(eq(syncState.userId, userId))
      .limit(1)

    const pending = row?.pending ?? []
    if (pending.length === 0) return { tally, complete: true }

    const [head, ...rest] = pending
    const outcome = await crawlSubtree(client, { queue: [head!], pageToken: null }, { deadline })

    tally.foldersUpserted += outcome.tally.foldersUpserted
    tally.documentsUpserted += outcome.tally.documentsUpserted
    tally.documentsRestored += outcome.tally.documentsRestored
    tally.skippedNonDocs += outcome.tally.skippedNonDocs

    if (!outcome.complete) return { tally, complete: false }

    await db
      .update(syncState)
      .set({ pendingSubtreeCrawls: rest })
      .where(eq(syncState.userId, userId))
  }

  return { tally, complete: false }
}

async function isLiveFolder(userId: string, driveFolderId: string): Promise<boolean> {
  const rows = await db
    .select({ id: folders.id })
    .from(folders)
    .where(
      and(
        eq(folders.userId, userId),
        eq(folders.driveFolderId, driveFolderId),
        isNull(folders.removedAt),
      ),
    )
    .limit(1)
  return rows.length > 0
}

/** Drive answers 410 when a page token has aged out. */
function isGonePageToken(err: unknown): boolean {
  return err instanceof DriveTransientError && err.status === 410
}

function applyTally(result: SyncResult, tally: CrawlTally): void {
  result.foldersUpserted += tally.foldersUpserted
  result.documentsUpserted += tally.documentsUpserted
  result.documentsRestored += tally.documentsRestored
  result.skippedNonDocs += tally.skippedNonDocs
}

export { emptyTally }
