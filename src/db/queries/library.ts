import 'server-only'
import { and, asc, count, eq, isNotNull, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { documents, folders, syncState } from '@/db/schema'

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
}

/**
 * Documents directly inside one folder.
 *
 * `includeRemoved` powers the "Removed" toggle. Removed rows are soft-deleted
 * (decisions §7a) and still carry their uuid, so a document moved out of the
 * root and back keeps its identity — which is what Phase 2's claims will hang off.
 */
export async function getDocuments(
  userId: string,
  folderDriveId: string,
  opts: { includeRemoved?: boolean } = {},
): Promise<DocumentRow[]> {
  const where = opts.includeRemoved
    ? and(eq(documents.userId, userId), eq(documents.parentDriveFolderId, folderDriveId))
    : and(
        eq(documents.userId, userId),
        eq(documents.parentDriveFolderId, folderDriveId),
        isNull(documents.removedAt),
      )

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
    })
    .from(documents)
    .where(where)
    .orderBy(asc(documents.name))
}

export async function getDocument(
  userId: string,
  driveFileId: string,
): Promise<DocumentRow | null> {
  const rows = await db
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
    })
    .from(documents)
    .where(and(eq(documents.userId, userId), eq(documents.driveFileId, driveFileId)))
    .limit(1)

  return rows[0] ?? null
}

export async function getRemovedCount(userId: string, folderDriveId: string): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(documents)
    .where(
      and(
        eq(documents.userId, userId),
        eq(documents.parentDriveFolderId, folderDriveId),
        isNotNull(documents.removedAt),
      ),
    )
  return rows[0]?.n ?? 0
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
