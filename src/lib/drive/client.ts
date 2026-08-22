import 'server-only'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { folders, syncState } from '@/db/schema'
import { DriveAuthError, OutOfScopeError } from '@/lib/google/errors'
import { DRIVE_ROOT_ALIAS, FILE_FIELDS, MIME_DOCUMENT, MIME_FOLDER } from './fields'
import { driveGet, escapeQueryValue, type DriveCallStats } from './request'
import { ScopeResolver } from './scope'
import type { DriveChangeList, DriveFile, DriveFileList } from './types'

/**
 * The scoped Drive surface. Every read here is confined to the user's chosen
 * root folder by ScopeResolver.
 *
 * Contrast with DriveBrowser, which is deliberately unscoped and reachable from
 * exactly one route. Keeping them as separate classes means the Library and sync
 * code paths have no syntax available that could read outside the root — there
 * is no flag to pass, no option to thread through, nothing to get wrong in a
 * review. See the header comment in browser.ts.
 */
export class DriveClient {
  /**
   * Assigned in forUser() immediately after construction. The resolver needs a
   * getFile bound to this instance, and this instance needs the resolver, so one
   * of the two has to be attached after the fact — doing it here keeps the
   * shared `stats` counter on a single object.
   */
  scope!: ScopeResolver
  readonly stats: DriveCallStats = { apiCalls: 0 }

  private constructor(
    readonly userId: string,
    readonly rootFolderId: string,
  ) {}

  static async forUser(userId: string): Promise<DriveClient> {
    const [state] = await db
      .select({ rootDriveFolderId: syncState.rootDriveFolderId })
      .from(syncState)
      .where(eq(syncState.userId, userId))
      .limit(1)

    const rootId = state?.rootDriveFolderId
    if (!rootId) {
      throw new DriveAuthError('not_connected', 'No root folder has been chosen')
    }

    // The mirrored tree seeds the resolver, so a normal sync needs zero
    // ancestry API calls: every parent is already a folder we know about.
    const known = await db
      .select({ driveFolderId: folders.driveFolderId })
      .from(folders)
      .where(and(eq(folders.userId, userId), isNull(folders.removedAt)))

    const client = new DriveClient(userId, rootId)

    client.scope = new ScopeResolver({
      rootId,
      knownInScope: known.map((f) => f.driveFolderId),
      // Bound to `client` so ancestry calls land on the same stats counter.
      getFile: (fileId) => client.rawGetFile(fileId, 'id,name,parents,driveId,trashed,mimeType'),
      onWarn: (message) => console.warn('[drive/scope]', message),
    })

    return client
  }

  /* ------------------------------------------------------------- raw reads */

  /**
   * Unchecked fetch. PRIVATE on purpose — the only callers are the scope
   * resolver's own ancestry walk (which must be able to read folders it has not
   * yet judged) and getFile below, which checks the result before returning it.
   */
  private rawGetFile(fileId: string, fields: string = FILE_FIELDS): Promise<DriveFile> {
    return driveGet<DriveFile>(
      this.userId,
      `/files/${encodeURIComponent(fileId)}`,
      { fields, supportsAllDrives: 'true' },
      this.stats,
    )
  }

  /* --------------------------------------------------------- scoped reads */

  /**
   * Fetch one file, refusing to return anything outside the root.
   *
   * Scope-checked because the Library detail pane's "Refresh from Drive" button
   * passes a file id from the client. Without the check, a hand-crafted request
   * would read any file in the user's Drive.
   *
   * Note the metadata is necessarily fetched before it can be judged — you
   * cannot know a file's parents without asking. What matters is that an
   * out-of-scope file is never returned to a caller and never persisted.
   */
  async getFile(fileId: string): Promise<DriveFile> {
    const file = await this.rawGetFile(fileId)
    const verdict = await this.scope.resolve({
      id: file.id,
      parents: file.parents,
      driveId: file.driveId,
    })
    if (verdict === 'out') throw new OutOfScopeError(fileId)
    return file
  }

  /**
   * The document body as markdown — one `files.export` call, per ADR §7.
   *
   * Routed through getFile() first, which is not merely a convenience: export
   * takes a file id from a caller, and without the scope check that id could
   * name any document in the user's Drive. The mime-type check is second
   * because Drive's own error for exporting a non-document is unhelpful, and
   * spreadsheets and slides are deliberately out of scope for now.
   */
  async exportMarkdown(fileId: string): Promise<string> {
    const file = await this.getFile(fileId)
    if (file.mimeType !== MIME_DOCUMENT) {
      throw new OutOfScopeError(`${fileId} is a ${file.mimeType}, not a Google Doc`)
    }

    return driveGet<string>(
      this.userId,
      `/files/${encodeURIComponent(fileId)}/export`,
      { mimeType: 'text/markdown' },
      this.stats,
      'text',
    )
  }

  /**
   * The id of the document's newest revision, for pinning an extraction to what
   * it actually read (ADR §6).
   *
   * §6 recorded that `files.get` has no `headRevisionId` for native Docs, and a
   * probe over this corpus confirmed it — absent on every one. `revisions.list`
   * does work on them, which is what this uses. Revisions come back oldest
   * first, so the head is the last one.
   *
   * **Do not use this to detect staleness.** Drive keeps *checkpoint* revisions
   * for a Doc, not one per edit: the largest document here is at `version=306`
   * with 6 revisions, so an id that has not moved does not mean the document has
   * not changed. `drive_version` is the staleness signal; this is provenance.
   */
  async getHeadRevisionId(fileId: string): Promise<string | null> {
    let pageToken: string | undefined
    let head: string | null = null

    do {
      const page = await driveGet<{
        revisions?: { id: string }[]
        nextPageToken?: string
      }>(
        this.userId,
        `/files/${encodeURIComponent(fileId)}/revisions`,
        { fields: 'nextPageToken,revisions(id)', pageSize: '1000', pageToken },
        this.stats,
      )

      const revisions = page.revisions ?? []
      if (revisions.length > 0) head = revisions[revisions.length - 1]!.id
      pageToken = page.nextPageToken
    } while (pageToken)

    return head
  }

  /** Immediate children of a folder that must itself already be in scope. */
  async listFolderChildren(
    folderId: string,
    pageToken?: string,
  ): Promise<{ files: DriveFile[]; nextPageToken?: string }> {
    if (folderId === DRIVE_ROOT_ALIAS) {
      // The literal alias would resolve to the top of My Drive, which is never
      // the root unless the user picked all of Drive — and even then we hold a
      // concrete id. Refuse rather than quietly widening scope.
      throw new OutOfScopeError(folderId)
    }

    if ((await this.scope.resolveFolder(folderId)) === 'out') {
      throw new OutOfScopeError(folderId)
    }

    const result = await driveGet<DriveFileList>(
      this.userId,
      '/files',
      {
        q: `'${escapeQueryValue(folderId)}' in parents and trashed = false`,
        pageSize: '1000',
        orderBy: 'folder,name',
        fields: `nextPageToken,files(${FILE_FIELDS})`,
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
        pageToken,
      },
      this.stats,
    )

    return {
      files: result.files ?? [],
      ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
    }
  }

  /* -------------------------------------------------------- the change feed */

  async getStartPageToken(): Promise<string> {
    const result = await driveGet<{ startPageToken?: string }>(
      this.userId,
      '/changes/startPageToken',
      { supportsAllDrives: 'true' },
      this.stats,
    )
    if (!result.startPageToken) {
      throw new Error('Drive returned no startPageToken')
    }
    return result.startPageToken
  }

  /**
   * Raw change feed. Returns changes for the user's WHOLE Drive — filtering to
   * the root subtree is the caller's job, via this.scope.
   *
   * `restrictToMyDrive` is deliberately left false. It would cut change volume,
   * but it silently drops changes when the root folder is shared to the user or
   * lives in a shared drive. The scope resolver is the sole authority on
   * containment; a second, weaker filter that can disagree with it is exactly
   * the kind of thing that produces a bug nobody can reproduce.
   */
  async listChanges(pageToken: string): Promise<DriveChangeList> {
    return driveGet<DriveChangeList>(
      this.userId,
      '/changes',
      {
        pageToken,
        pageSize: '1000',
        spaces: 'drive',
        includeRemoved: 'true',
        includeItemsFromAllDrives: 'true',
        supportsAllDrives: 'true',
        restrictToMyDrive: 'false',
        fields: `nextPageToken,newStartPageToken,changes(changeType,removed,fileId,time,driveId,file(${FILE_FIELDS}))`,
      },
      this.stats,
    )
  }

  /** Subfolders only — used by the BFS crawl to enqueue. */
  isFolderMime(mimeType: string | undefined): boolean {
    return mimeType === MIME_FOLDER
  }
}
