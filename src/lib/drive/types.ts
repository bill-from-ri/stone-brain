/**
 * The subset of the Drive v3 File resource we request. Everything is optional
 * because Drive omits fields rather than nulling them, and a `changes.list`
 * payload for a removed file carries no `file` object at all.
 */
export type DriveFile = {
  id: string
  name?: string
  mimeType?: string
  parents?: string[]
  driveId?: string
  /** Monotonic; bumps on every server-side change. Serialized as a string. */
  version?: string
  modifiedTime?: string
  createdTime?: string
  trashed?: boolean
  explicitlyTrashed?: boolean
  webViewLink?: string
  iconLink?: string
  size?: string
  ownedByMe?: boolean
  owners?: { displayName?: string; emailAddress?: string }[]
  lastModifyingUser?: { displayName?: string }
  shortcutDetails?: { targetId?: string; targetMimeType?: string }
}

export type DriveFileList = {
  files?: DriveFile[]
  nextPageToken?: string
  incompleteSearch?: boolean
}

export type DriveChange = {
  changeType?: string
  /** True for a hard delete or a file that left the user's view. No `file` payload. */
  removed?: boolean
  fileId?: string
  time?: string
  file?: DriveFile
  driveId?: string
}

export type DriveChangeList = {
  changes?: DriveChange[]
  nextPageToken?: string
  newStartPageToken?: string
}

/** A folder as the picker needs it — deliberately minimal. */
export type BrowsableFolder = {
  id: string
  name: string
}

export function isFolder(file: DriveFile): boolean {
  return file.mimeType === 'application/vnd.google-apps.folder'
}

export function isNativeDoc(file: DriveFile): boolean {
  return file.mimeType === 'application/vnd.google-apps.document'
}

/** Drive returns int64 as a string; parse defensively rather than trusting it. */
export function parseVersion(v: string | undefined): number | null {
  if (!v) return null
  const n = Number(v)
  return Number.isSafeInteger(n) ? n : null
}

export function parseDriveDate(v: string | undefined): Date | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}
