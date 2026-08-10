/**
 * One field list, used by every call that reads a file or folder.
 *
 * Keeping it in a single constant matters more than it looks: `documents.raw`
 * and `folders.raw` store this payload verbatim (decisions §6), so a field
 * requested in one code path and not another would produce rows whose JSONB
 * silently differs depending on which path last wrote them.
 */
export const FILE_FIELDS = [
  'id',
  'name',
  'mimeType',
  'parents',
  'driveId',
  'version',
  'modifiedTime',
  'createdTime',
  'trashed',
  'explicitlyTrashed',
  'webViewLink',
  'iconLink',
  'size',
  'ownedByMe',
  'owners(displayName,emailAddress)',
  'lastModifyingUser(displayName)',
  'shortcutDetails(targetId,targetMimeType)',
].join(',')

export const MIME_FOLDER = 'application/vnd.google-apps.folder'
export const MIME_DOCUMENT = 'application/vnd.google-apps.document'
export const MIME_SHORTCUT = 'application/vnd.google-apps.shortcut'

/** Drive's alias for the top of My Drive. */
export const DRIVE_ROOT_ALIAS = 'root'
