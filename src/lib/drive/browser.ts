import 'server-only'
import { DRIVE_ROOT_ALIAS, MIME_FOLDER } from './fields'
import { driveGet, escapeQueryValue } from './request'
import type { BrowsableFolder, DriveFile, DriveFileList } from './types'

/**
 * ============================================================================
 * THIS MODULE IS DELIBERATELY UNSCOPED. IT CAN READ ANY FOLDER IN THE USER'S
 * DRIVE, AND IT IS THE ONLY MODULE THAT CAN.
 * ============================================================================
 *
 * The root-folder picker genuinely has to enumerate the whole Drive — there is
 * no way to choose a root without seeing what's available. That capability is
 * quarantined here, in a separate class with a different name, reachable from
 * exactly one route: /api/drive/browse.
 *
 * The alternative — a single DriveClient with a `{ skipScopeCheck: true }`
 * option — is precisely how a privacy incident gets introduced: someone threads
 * the flag up from a caller three layers away and nobody notices in review.
 * Because this is a separate class, the Library code path has no syntax
 * available to it that could read outside the chosen root.
 *
 * Rules for this file:
 *   - Nothing here may be imported by anything under src/lib/sync or the Library.
 *   - It returns folder names and ids only. It never returns file contents, and
 *     never persists anything to documents/folders.
 *   - Any new method must be justifiable as "the user cannot pick a root folder
 *     without this".
 */
export class DriveBrowser {
  private constructor(private readonly userId: string) {}

  static forUser(userId: string): DriveBrowser {
    return new DriveBrowser(userId)
  }

  /**
   * Immediate subfolders of `parentId`, for lazy expansion in the picker.
   * `parentId` defaults to Drive's `root` alias (the top of My Drive).
   */
  async listFolders(
    parentId: string = DRIVE_ROOT_ALIAS,
    pageToken?: string,
  ): Promise<{ folders: BrowsableFolder[]; nextPageToken?: string }> {
    const q = [
      `mimeType = '${MIME_FOLDER}'`,
      'trashed = false',
      `'${escapeQueryValue(parentId)}' in parents`,
    ].join(' and ')

    const result = await driveGet<DriveFileList>(this.userId, '/files', {
      q,
      pageSize: '100',
      orderBy: 'name',
      fields: 'nextPageToken,files(id,name)',
      // A root folder may live in a shared drive; without these the picker
      // silently shows nothing there and the user cannot explain why.
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      corpora: 'allDrives',
      pageToken,
    })

    return {
      folders: toBrowsable(result.files),
      ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
    }
  }

  /**
   * Flat name search across the whole Drive.
   *
   * Much kinder than clicking down six levels, and the reason the picker doesn't
   * need to be a perfect tree.
   */
  async searchFolders(term: string): Promise<BrowsableFolder[]> {
    const trimmed = term.trim()
    if (trimmed.length < 2) return []

    const q = [
      `mimeType = '${MIME_FOLDER}'`,
      'trashed = false',
      `name contains '${escapeQueryValue(trimmed)}'`,
    ].join(' and ')

    const result = await driveGet<DriveFileList>(this.userId, '/files', {
      q,
      pageSize: '50',
      orderBy: 'name',
      fields: 'files(id,name)',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      corpora: 'allDrives',
    })

    return toBrowsable(result.files)
  }

  /**
   * Resolve one folder by id, to confirm a picked root actually exists and is
   * readable before we commit it.
   *
   * The name is re-fetched server-side rather than trusted from the client: the
   * chosen root's name is displayed throughout the app, and accepting it from a
   * request body would let a caller write arbitrary text into the UI.
   */
  async getFolder(folderId: string): Promise<DriveFile> {
    return driveGet<DriveFile>(this.userId, `/files/${encodeURIComponent(folderId)}`, {
      fields: 'id,name,mimeType,parents,driveId,trashed',
      supportsAllDrives: 'true',
    })
  }
}

function toBrowsable(files: DriveFile[] | undefined): BrowsableFolder[] {
  return (files ?? [])
    .filter((f): f is DriveFile & { id: string } => Boolean(f.id))
    .map((f) => ({ id: f.id, name: f.name ?? '(untitled folder)' }))
}
