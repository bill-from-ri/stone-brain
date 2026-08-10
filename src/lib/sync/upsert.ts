import 'server-only'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { AnyPgColumn, PgTransaction } from 'drizzle-orm/pg-core'
import { db } from '@/db'
import { documents, folders } from '@/db/schema'
import { parseDriveDate, parseVersion, type DriveFile } from '@/lib/drive/types'

/**
 * Every write to the projection goes through here.
 *
 * Two properties everything below depends on:
 *   - Writes are UPSERTS keyed on (user_id, drive_*_id), so replaying a page of
 *     changes after a crash is harmless. That, plus the page-token ordering rule
 *     in sync-root, is the entirety of "idempotent and resumable".
 *   - Deletes are SOFT. A file that leaves the root keeps its row and its uuid,
 *     so moving it back restores the same documents.id and Phase 2's claims
 *     survive the round trip (decisions §5, §7a).
 */

type Tx = PgTransaction<any, any, any> | typeof db

export async function upsertFolder(
  tx: Tx,
  userId: string,
  file: DriveFile,
  opts: { sweepId?: string | undefined } = {},
): Promise<void> {
  const now = new Date()
  const name = file.name ?? '(untitled folder)'
  const parent = file.parents?.[0] ?? null

  await tx
    .insert(folders)
    .values({
      userId,
      driveFolderId: file.id,
      parentDriveFolderId: parent,
      name,
      trashed: file.trashed ?? false,
      driveModifiedTime: parseDriveDate(file.modifiedTime),
      raw: file,
      sweepId: opts.sweepId ?? null,
      syncedAt: now,
    })
    .onConflictDoUpdate({
      target: [folders.userId, folders.driveFolderId],
      set: {
        parentDriveFolderId: parent,
        name,
        trashed: file.trashed ?? false,
        // Seeing it again means it is back in scope.
        removedAt: null,
        driveModifiedTime: parseDriveDate(file.modifiedTime),
        raw: file,
        sweepId: opts.sweepId ?? null,
        syncedAt: now,
      },
    })
}

/** @returns whether this write RESTORED a previously removed document. */
export async function upsertDocument(
  tx: Tx,
  userId: string,
  file: DriveFile,
  opts: { sweepId?: string | undefined } = {},
): Promise<{ restored: boolean }> {
  const now = new Date()
  const parent = file.parents?.[0] ?? null

  const existing = await tx
    .select({ removedAt: documents.removedAt })
    .from(documents)
    .where(and(eq(documents.userId, userId), eq(documents.driveFileId, file.id)))
    .limit(1)

  const restored = Boolean(existing[0]?.removedAt)

  await tx
    .insert(documents)
    .values({
      userId,
      driveFileId: file.id,
      parentDriveFolderId: parent,
      name: file.name ?? '(untitled)',
      mimeType: file.mimeType ?? '',
      driveVersion: parseVersion(file.version),
      modifiedTime: parseDriveDate(file.modifiedTime),
      createdTime: parseDriveDate(file.createdTime),
      webViewLink: file.webViewLink ?? null,
      iconLink: file.iconLink ?? null,
      ownerDisplayName: file.owners?.[0]?.displayName ?? null,
      ownedByMe: file.ownedByMe ?? null,
      trashed: file.trashed ?? false,
      raw: file,
      sweepId: opts.sweepId ?? null,
      syncedAt: now,
    })
    .onConflictDoUpdate({
      target: [documents.userId, documents.driveFileId],
      set: {
        parentDriveFolderId: parent,
        name: file.name ?? '(untitled)',
        mimeType: file.mimeType ?? '',
        driveVersion: parseVersion(file.version),
        modifiedTime: parseDriveDate(file.modifiedTime),
        webViewLink: file.webViewLink ?? null,
        iconLink: file.iconLink ?? null,
        ownerDisplayName: file.owners?.[0]?.displayName ?? null,
        ownedByMe: file.ownedByMe ?? null,
        trashed: file.trashed ?? false,
        removedAt: null,
        raw: file,
        sweepId: opts.sweepId ?? null,
        syncedAt: now,
      },
    })

  return { restored }
}

/**
 * Soft-remove a folder and everything beneath it.
 *
 * Drive reports ONE change event when a folder moves out of the root, and will
 * never enumerate the descendants for us — from Drive's point of view nothing
 * happened to them. So we synthesize the cascade from our own mirror. This is
 * also why it still works when the folder has moved somewhere we can no longer
 * read: we are reading our copy, not Drive.
 *
 * @returns counts of what was removed.
 */
export async function cascadeRemoveFolder(
  tx: Tx,
  userId: string,
  rootFolderDriveId: string,
): Promise<{ folders: number; documents: number }> {
  const now = new Date()

  // Collect the subtree from our mirror, breadth-first.
  const all = await tx
    .select({
      driveFolderId: folders.driveFolderId,
      parentDriveFolderId: folders.parentDriveFolderId,
    })
    .from(folders)
    .where(and(eq(folders.userId, userId), isNull(folders.removedAt)))

  const childrenOf = new Map<string, string[]>()
  for (const row of all) {
    if (!row.parentDriveFolderId) continue
    const list = childrenOf.get(row.parentDriveFolderId) ?? []
    list.push(row.driveFolderId)
    childrenOf.set(row.parentDriveFolderId, list)
  }

  const subtree: string[] = []
  const queue = [rootFolderDriveId]
  const seen = new Set<string>()
  while (queue.length > 0) {
    const id = queue.shift()!
    if (seen.has(id)) continue // defensive: a cycle would otherwise hang the sync
    seen.add(id)
    subtree.push(id)
    queue.push(...(childrenOf.get(id) ?? []))
  }

  const removedFolders = await tx
    .update(folders)
    .set({ removedAt: now, syncedAt: now })
    .where(
      and(
        eq(folders.userId, userId),
        inArray(folders.driveFolderId, subtree),
        isNull(folders.removedAt),
      ),
    )
    .returning({ id: folders.id })

  const removedDocs = await tx
    .update(documents)
    .set({ removedAt: now, syncedAt: now })
    .where(
      and(
        eq(documents.userId, userId),
        inArray(documents.parentDriveFolderId, subtree),
        isNull(documents.removedAt),
      ),
    )
    .returning({ id: documents.id })

  return { folders: removedFolders.length, documents: removedDocs.length }
}

export async function removeDocument(
  tx: Tx,
  userId: string,
  driveFileId: string,
): Promise<boolean> {
  const now = new Date()
  const rows = await tx
    .update(documents)
    .set({ removedAt: now, syncedAt: now })
    .where(
      and(
        eq(documents.userId, userId),
        eq(documents.driveFileId, driveFileId),
        isNull(documents.removedAt),
      ),
    )
    .returning({ id: documents.id })

  return rows.length > 0
}

/**
 * Recompute path and depth for the whole tree, and resolve the uuid parent FKs.
 *
 * Done in one pass at the end of a sync rather than incrementally, because a
 * single folder move changes the path of everything beneath it and the tree is
 * small enough (tens to low hundreds of rows) that recomputing beats tracking.
 */
export async function recomputeTree(userId: string): Promise<void> {
  const rows = await db
    .select({
      id: folders.id,
      driveFolderId: folders.driveFolderId,
      parentDriveFolderId: folders.parentDriveFolderId,
      name: folders.name,
      isRoot: folders.isRoot,
    })
    .from(folders)
    .where(and(eq(folders.userId, userId), isNull(folders.removedAt)))

  if (rows.length === 0) return

  const byDriveId = new Map(rows.map((r) => [r.driveFolderId, r]))

  const computed = new Map<string, { path: string; depth: number }>()
  const resolve = (driveId: string, guard = 0): { path: string; depth: number } => {
    const cached = computed.get(driveId)
    if (cached) return cached

    const row = byDriveId.get(driveId)
    if (!row || guard > 32) {
      const fallback = { path: '/', depth: 0 }
      computed.set(driveId, fallback)
      return fallback
    }

    let result: { path: string; depth: number }
    if (row.isRoot || !row.parentDriveFolderId || !byDriveId.has(row.parentDriveFolderId)) {
      result = { path: `/${row.name}`, depth: 0 }
    } else {
      const parent = resolve(row.parentDriveFolderId, guard + 1)
      result = { path: `${parent.path}/${row.name}`, depth: parent.depth + 1 }
    }
    computed.set(driveId, result)
    return result
  }

  for (const row of rows) resolve(row.driveFolderId)

  // One statement per folder is fine at this scale and far clearer than a
  // hand-built CASE expression over the whole table.
  await Promise.all(
    rows.map((row) => {
      const { path, depth } = computed.get(row.driveFolderId)!
      const parentUuid = row.parentDriveFolderId
        ? (byDriveId.get(row.parentDriveFolderId)?.id ?? null)
        : null
      return db
        .update(folders)
        .set({ path, depth, folderId: parentUuid })
        .where(eq(folders.id, row.id))
    }),
  )

  // Point documents at their folder's uuid, for join convenience only. The
  // Drive-id link is the authoritative one, because change events arrive out of
  // order and a file's change can precede its new parent folder's.
  await db.execute(sql`
    update ${documents} d
       set folder_id = f.id
      from ${folders} f
     where d.user_id = ${userId}
       and f.user_id = ${userId}
       and d.parent_drive_folder_id = f.drive_folder_id
       and (d.folder_id is distinct from f.id)
  `)
}

/**
 * Anything not visited by a full crawl is no longer in the subtree.
 *
 * This is what catches deletions that happened while a page token was dead —
 * nothing in the change feed will ever mention them, so only a generation stamp
 * can find them.
 */
export async function reconciliationSweep(
  userId: string,
  sweepId: string,
): Promise<{ folders: number; documents: number }> {
  const now = new Date()

  const staleFolders = await db
    .update(folders)
    .set({ removedAt: now })
    .where(
      and(
        eq(folders.userId, userId),
        isNull(folders.removedAt),
        eq(folders.isRoot, false),
        notVisitedBy(folders.sweepId, sweepId),
      ),
    )
    .returning({ id: folders.id })

  const staleDocs = await db
    .update(documents)
    .set({ removedAt: now })
    .where(
      and(
        eq(documents.userId, userId),
        isNull(documents.removedAt),
        notVisitedBy(documents.sweepId, sweepId),
      ),
    )
    .returning({ id: documents.id })

  return { folders: staleFolders.length, documents: staleDocs.length }
}

/** `sweep_id IS NULL OR sweep_id <> $current` — "not visited by this crawl". */
function notVisitedBy(column: AnyPgColumn, sweepId: string) {
  return sql`(${column} is null or ${column} <> ${sweepId}::uuid)`
}
