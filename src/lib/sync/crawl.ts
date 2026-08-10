import 'server-only'
import { db } from '@/db'
import { MIME_DOCUMENT, MIME_FOLDER } from '@/lib/drive/fields'
import type { DriveClient } from '@/lib/drive/client'
import type { CrawlCursor } from '@/db/schema'
import { upsertDocument, upsertFolder } from './upsert'

/**
 * Breadth-first enumeration of a folder subtree.
 *
 * Used for the initial crawl, and again whenever a folder moves INTO the root —
 * Drive reports that as one change event and never enumerates the subtree, so
 * we have to walk it ourselves.
 *
 * No scope resolution happens here, and that is not an oversight: descending
 * from a known in-scope folder means everything found is in scope by
 * construction. It is a genuinely nice property, and it is why the initial crawl
 * costs zero ancestry API calls.
 */

export type CrawlTally = {
  foldersUpserted: number
  documentsUpserted: number
  documentsRestored: number
  skippedNonDocs: number
  foldersVisited: number
}

export type CrawlOutcome = {
  tally: CrawlTally
  /** Null when the subtree was fully enumerated. */
  cursor: CrawlCursor | null
  complete: boolean
}

export function emptyTally(): CrawlTally {
  return {
    foldersUpserted: 0,
    documentsUpserted: 0,
    documentsRestored: 0,
    skippedNonDocs: 0,
    foldersVisited: 0,
  }
}

export async function crawlSubtree(
  client: DriveClient,
  start: CrawlCursor,
  opts: {
    sweepId?: string | undefined
    deadline: number
    onProgress?: ((cursor: CrawlCursor, tally: CrawlTally) => Promise<void>) | undefined
  },
): Promise<CrawlOutcome> {
  const tally = emptyTally()
  const queue = [...start.queue]
  let pageToken: string | null = start.pageToken

  while (queue.length > 0) {
    const folderId = queue[0]!

    const page = await client.listFolderChildren(folderId, pageToken ?? undefined)

    // One transaction per page: a crash loses at most this page's writes, and
    // every write is an idempotent upsert, so re-running is harmless.
    await db.transaction(async (tx) => {
      for (const file of page.files) {
        if (!file.id) continue

        if (file.mimeType === MIME_FOLDER) {
          await upsertFolder(tx, client.userId, file, { sweepId: opts.sweepId })
          tally.foldersUpserted++
          queue.push(file.id)
          // Newly discovered folders are in scope by construction; telling the
          // resolver now saves an ancestry walk if a change for one of their
          // files arrives later in the same run.
          client.scope.markInScope(file.id)
        } else if (file.mimeType === MIME_DOCUMENT) {
          const { restored } = await upsertDocument(tx, client.userId, file, {
            sweepId: opts.sweepId,
          })
          tally.documentsUpserted++
          if (restored) tally.documentsRestored++
        } else {
          // Slides, sheets, images, PDFs, shortcuts. Counted rather than
          // ignored so "my file didn't show up" has an answer.
          tally.skippedNonDocs++
        }
      }
    })

    if (page.nextPageToken) {
      pageToken = page.nextPageToken
    } else {
      queue.shift()
      pageToken = null
      tally.foldersVisited++
    }

    const cursor: CrawlCursor = { queue, pageToken }
    if (opts.onProgress) await opts.onProgress(cursor, tally)

    // Yield rather than risk the invocation being killed mid-write. The cursor
    // is already persisted, so the next call resumes exactly here.
    if (Date.now() > opts.deadline && queue.length > 0) {
      return { tally, cursor, complete: false }
    }
  }

  return { tally, cursor: null, complete: true }
}
