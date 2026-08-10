import { NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { folders, syncState } from '@/db/schema'
import { apiRequireUser } from '@/lib/auth/guard'
import { DriveBrowser } from '@/lib/drive/browser'
import { MIME_FOLDER } from '@/lib/drive/fields'
import { DriveAuthError, DriveNotFoundError } from '@/lib/google/errors'

const bodySchema = z.object({ folderId: z.string().min(1).max(256) })

/**
 * Commit the user's chosen root folder.
 *
 * This is the moment the app leaves the `needs_root` state, so it is also the
 * moment the folder tree gets its anchor row. The actual crawl is M5; this
 * route establishes the root and leaves start_page_token null, which is
 * precisely the signal sync_root uses to decide it must do an initial crawl.
 */
export async function POST(request: Request) {
  const guard = await apiRequireUser()
  if (!guard.ok) return guard.response

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  const userId = guard.session.user.id
  const browser = DriveBrowser.forUser(userId)

  // Re-fetch server-side rather than trusting the client's folder name. This
  // also validates that the id is real, is a folder, and is actually readable
  // by this user before we build a whole projection on top of it.
  let folder
  try {
    folder = await browser.getFolder(parsed.data.folderId)
  } catch (err) {
    if (err instanceof DriveNotFoundError) {
      return NextResponse.json({ error: 'folder_not_found' }, { status: 404 })
    }
    if (err instanceof DriveAuthError) {
      return NextResponse.json({ error: 'drive_auth', reason: err.reason }, { status: 409 })
    }
    console.error('[setup/root]', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: 'drive_unavailable' }, { status: 502 })
  }

  if (folder.mimeType !== MIME_FOLDER) {
    return NextResponse.json({ error: 'not_a_folder' }, { status: 400 })
  }
  if (folder.trashed) {
    return NextResponse.json({ error: 'folder_trashed' }, { status: 400 })
  }

  const name = folder.name ?? 'Drive folder'
  const now = new Date()

  await db.transaction(async (tx) => {
    await tx
      .insert(syncState)
      .values({
        userId,
        rootDriveFolderId: folder.id,
        rootFolderName: name,
        // Left null on purpose: null start_page_token is what tells sync_root
        // to run an initial crawl rather than an incremental pass.
        startPageToken: null,
        initialCrawlDone: false,
      })
      .onConflictDoUpdate({
        target: syncState.userId,
        set: {
          rootDriveFolderId: folder.id,
          rootFolderName: name,
          startPageToken: null,
          pendingStartPageToken: null,
          initialCrawlDone: false,
          crawlCursor: null,
          pendingSubtreeCrawls: [],
          lastSyncError: null,
        },
      })

    // The anchor row for the tree. parent is null and isRoot is true — the two
    // things that terminate every ancestry walk and every path recomputation.
    await tx
      .insert(folders)
      .values({
        userId,
        driveFolderId: folder.id,
        parentDriveFolderId: null,
        name,
        path: `/${name}`,
        depth: 0,
        isRoot: true,
        raw: folder,
        syncedAt: now,
      })
      .onConflictDoUpdate({
        target: [folders.userId, folders.driveFolderId],
        set: {
          name,
          path: `/${name}`,
          depth: 0,
          isRoot: true,
          parentDriveFolderId: null,
          removedAt: null,
          trashed: false,
          raw: folder,
          syncedAt: now,
        },
      })
  })

  return NextResponse.json({ ok: true, rootFolderId: folder.id, rootFolderName: name })
}

/**
 * Changing the root later clears the index and re-crawls.
 *
 * Safe in Phase 1 because nothing derives from documents yet. Once claims exist
 * this becomes destructive in a way users will not expect — decisions §15 flags
 * it, and Phase 2 needs a better answer than "soft-delete everything".
 */
export async function DELETE() {
  const guard = await apiRequireUser()
  if (!guard.ok) return guard.response

  const userId = guard.session.user.id
  const now = new Date()

  await db.transaction(async (tx) => {
    await tx.update(folders).set({ removedAt: now }).where(eq(folders.userId, userId))
    await tx
      .update(syncState)
      .set({
        rootDriveFolderId: null,
        rootFolderName: null,
        startPageToken: null,
        pendingStartPageToken: null,
        initialCrawlDone: false,
        crawlCursor: null,
        pendingSubtreeCrawls: [],
      })
      .where(eq(syncState.userId, userId))
  })

  return NextResponse.json({ ok: true })
}
