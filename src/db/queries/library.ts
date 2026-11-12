import 'server-only'
import { and, asc, count, eq, ilike, isNull, max, sql } from 'drizzle-orm'
import { db } from '@/db'
import { claimSources, documents, extractionRuns, folders, syncState } from '@/db/schema'

/**
 * Every query here takes userId as its first parameter and filters on it.
 * A query without a user scope is the same class of bug as a scope-check bypass,
 * so there are no exceptions and no "internal" variants.
 */

export async function getShellCounts(
  userId: string,
): Promise<{ documentCount: number; folderCount: number }> {
  const [docs, dirs] = await Promise.all([
    db
      .select({ n: count() })
      .from(documents)
      .where(and(eq(documents.userId, userId), isNull(documents.removedAt))),
    db
      .select({ n: count() })
      .from(folders)
      .where(
        and(eq(folders.userId, userId), isNull(folders.removedAt), eq(folders.isRoot, false)),
      ),
  ])

  return { documentCount: docs[0]?.n ?? 0, folderCount: dirs[0]?.n ?? 0 }
}

export type FolderRow = {
  driveFolderId: string
  parentDriveFolderId: string | null
  name: string
  path: string | null
  depth: number
  isRoot: boolean
}

/**
 * The whole tree in one query, assembled in memory by the caller.
 *
 * Deliberately not a recursive CTE: the tree is tens to low hundreds of rows per
 * user, and a flat ordered fetch is both faster and far easier to reason about.
 */
export async function getFolderTree(userId: string): Promise<FolderRow[]> {
  return db
    .select({
      driveFolderId: folders.driveFolderId,
      parentDriveFolderId: folders.parentDriveFolderId,
      name: folders.name,
      path: folders.path,
      depth: folders.depth,
      isRoot: folders.isRoot,
    })
    .from(folders)
    .where(and(eq(folders.userId, userId), isNull(folders.removedAt)))
    .orderBy(asc(folders.depth), asc(folders.name))
}

export async function getFolderDocCounts(userId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ parent: documents.parentDriveFolderId, n: count() })
    .from(documents)
    .where(and(eq(documents.userId, userId), isNull(documents.removedAt)))
    .groupBy(documents.parentDriveFolderId)

  const map = new Map<string, number>()
  for (const row of rows) {
    if (row.parent) map.set(row.parent, row.n)
  }
  return map
}

export type DocumentRow = {
  id: string
  driveFileId: string
  name: string
  webViewLink: string | null
  modifiedTime: Date | null
  createdTime: Date | null
  ownerDisplayName: string | null
  status: string
  trashed: boolean
  removedAt: Date | null
  driveVersion: number | null
  sizeBytes: number | null
  /** The `drive_version` the last extraction read — staleness is this against `driveVersion`. */
  extractedDriveVersion: number | null
  /** Distinct claims citing this document, inverses included (they carry its quote too). */
  claimCount: number
  /** When the last *successful* run finished. A failed run is not an extraction. */
  lastExtractedAt: Date | null
}

/**
 * Per-document claim counts, as a grouped subquery joined back on — one pass
 * over `claim_sources` for the whole folder rather than a correlated count per
 * row. `count(distinct claim_id)`, because a claim quoted from two paragraphs
 * of the same document has two source rows and is still one claim.
 */
function claimCounts(userId: string) {
  return db
    .select({
      documentId: claimSources.documentId,
      n: sql<number>`count(distinct ${claimSources.claimId})::int`.as('claim_n'),
    })
    .from(claimSources)
    .where(eq(claimSources.userId, userId))
    .groupBy(claimSources.documentId)
    .as('claim_counts')
}

function lastExtractions(userId: string) {
  return db
    .select({
      documentId: extractionRuns.documentId,
      at: max(extractionRuns.finishedAt).as('last_extracted_at'),
    })
    .from(extractionRuns)
    .where(and(eq(extractionRuns.userId, userId), eq(extractionRuns.status, 'succeeded')))
    .groupBy(extractionRuns.documentId)
    .as('last_extractions')
}

/** The Library's row shape, with its two aggregates attached. */
function documentRows(userId: string) {
  const counts = claimCounts(userId)
  const extracted = lastExtractions(userId)

  return db
    .select({
      id: documents.id,
      driveFileId: documents.driveFileId,
      name: documents.name,
      webViewLink: documents.webViewLink,
      modifiedTime: documents.modifiedTime,
      createdTime: documents.createdTime,
      ownerDisplayName: documents.ownerDisplayName,
      status: documents.status,
      trashed: documents.trashed,
      removedAt: documents.removedAt,
      driveVersion: documents.driveVersion,
      sizeBytes: documents.sizeBytes,
      extractedDriveVersion: documents.extractedDriveVersion,
      claimCount: sql<number>`coalesce(${counts.n}, 0)`.mapWith(Number),
      // An aggregate read back through a subquery alias arrives as the
      // driver's raw value, not through the column's own mapping.
      lastExtractedAt: sql<Date | null>`${extracted.at}`.mapWith((v: string | Date) => new Date(v)),
    })
    .from(documents)
    .leftJoin(counts, eq(counts.documentId, documents.id))
    .leftJoin(extracted, eq(extracted.documentId, documents.id))
    .$dynamic()
}

/**
 * Documents directly inside one folder.
 *
 * Soft-deleted rows are never returned. The Library shows what is in your Drive
 * folder now; a document that left it is not in your library, and the tombstone
 * exists for the claim graph rather than for this table (decisions §7a).
 *
 * The row itself survives, keeping its uuid, so a document moved out of the root
 * and back keeps the identity Phase 2's claims hang off.
 */
export async function getDocuments(
  userId: string,
  folderDriveId: string,
): Promise<DocumentRow[]> {
  return documentRows(userId)
    .where(
      and(
        eq(documents.userId, userId),
        eq(documents.parentDriveFolderId, folderDriveId),
        isNull(documents.removedAt),
      ),
    )
    .orderBy(asc(documents.name))
}

/**
 * One document for the detail pane.
 *
 * Also excludes soft-deleted rows, so a stale `?doc=` link to something that has
 * since left the folder opens nothing rather than a pane describing a document
 * the table beside it cannot show.
 */
export async function getDocument(
  userId: string,
  driveFileId: string,
): Promise<DocumentRow | null> {
  const rows = await documentRows(userId)
    .where(
      and(
        eq(documents.userId, userId),
        eq(documents.driveFileId, driveFileId),
        isNull(documents.removedAt),
      ),
    )
    .limit(1)

  return rows[0] ?? null
}

export type SearchHit = {
  driveFileId: string
  name: string
  /** Where to navigate to show it: the folder whose table contains this row. */
  parentDriveFolderId: string | null
  /** The folder's stored path, e.g. '/Nevlos/History'. Null for orphans. */
  folderPath: string | null
}

/**
 * Name search across the whole library, for the header's typeahead.
 *
 * Removed documents are excluded: the dropdown navigates to a folder view, and
 * the default view of that folder would not contain the row it just sent you to.
 */
export async function searchDocuments(
  userId: string,
  query: string,
  limit = 12,
): Promise<SearchHit[]> {
  // The caller's text is a literal, not a pattern. Escaping is what keeps a
  // stray '%' from turning into "match everything".
  const escaped = query.replace(/([\\%_])/g, '\\$1')

  return db
    .select({
      driveFileId: documents.driveFileId,
      name: documents.name,
      parentDriveFolderId: documents.parentDriveFolderId,
      folderPath: folders.path,
    })
    .from(documents)
    .leftJoin(
      folders,
      and(
        eq(folders.userId, documents.userId),
        eq(folders.driveFolderId, documents.parentDriveFolderId),
      ),
    )
    .where(
      and(
        eq(documents.userId, userId),
        isNull(documents.removedAt),
        ilike(documents.name, `%${escaped}%`),
      ),
    )
    .orderBy(asc(documents.name))
    .limit(limit)
}

export type SyncStatus = {
  lastSyncCompletedAt: string | null
  initialCrawlDone: boolean
  syncSeq: number
  lastSyncError: string | null
}

export async function getSyncStatus(userId: string): Promise<SyncStatus | null> {
  const rows = await db
    .select({
      lastSyncCompletedAt: syncState.lastSyncCompletedAt,
      initialCrawlDone: syncState.initialCrawlDone,
      syncSeq: syncState.syncSeq,
      lastSyncError: syncState.lastSyncError,
    })
    .from(syncState)
    .where(eq(syncState.userId, userId))
    .limit(1)

  const row = rows[0]
  if (!row) return null
  return {
    lastSyncCompletedAt: row.lastSyncCompletedAt?.toISOString() ?? null,
    initialCrawlDone: row.initialCrawlDone,
    syncSeq: row.syncSeq,
    lastSyncError: row.lastSyncError,
  }
}
