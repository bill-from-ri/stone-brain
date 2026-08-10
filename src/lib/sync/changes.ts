import type { DriveChange, DriveFile } from '@/lib/drive/types'
import { MIME_DOCUMENT, MIME_FOLDER } from '@/lib/drive/fields'

/**
 * Classification of a Drive change into what we should do about it.
 *
 * Deliberately pure and DB-free: the folder-transition table below is the least
 * obvious part of the whole sync and the most likely place for a future
 * regression, so it needs to be testable without a database or a network.
 */

export type FolderAction =
  /** In scope now: write it, and treat it as in-scope for the rest of this page. */
  | { kind: 'upsert' }
  /** Left the root (moved out, trashed, or hard-deleted): soft-remove the subtree. */
  | { kind: 'cascade-remove' }
  /**
   * Entered the root. Drive reports ONE event and never enumerates the subtree,
   * so we must walk it ourselves.
   */
  | { kind: 'upsert-and-crawl' }
  /** Out of scope before and after. Nothing to do. */
  | { kind: 'ignore' }

export type FileAction =
  | { kind: 'upsert' }
  | { kind: 'remove' }
  | { kind: 'ignore'; reason: 'not-a-doc' | 'out-of-scope' }

/**
 * The folder transition table.
 *
 * `wasKnown` means we hold a live (non-removed) row for it, i.e. it was inside
 * the root as far as we knew. `isInScope` is the scope resolver's verdict now.
 */
export function classifyFolderChange(input: {
  wasKnown: boolean
  isInScope: boolean
  removed: boolean
  trashed: boolean
}): FolderAction {
  // A hard delete or a trashing removes it from the library either way. Note
  // Drive sometimes also emits changes for descendants; every write is an
  // idempotent upsert and every removal is idempotent, so that is harmless.
  if (input.removed || input.trashed) {
    return input.wasKnown ? { kind: 'cascade-remove' } : { kind: 'ignore' }
  }

  if (input.isInScope) {
    // out -> in: we know nothing about what is beneath it.
    // in  -> in: a rename or a move within the root; the upsert covers both,
    //            and paths are recomputed at the end of the sync.
    return input.wasKnown ? { kind: 'upsert' } : { kind: 'upsert-and-crawl' }
  }

  // in -> out: cascade from our own mirror, because Drive will never tell us
  // what was underneath — from its point of view nothing happened to those files.
  return input.wasKnown ? { kind: 'cascade-remove' } : { kind: 'ignore' }
}

export function classifyFileChange(input: {
  mimeType: string | undefined
  isInScope: boolean
  removed: boolean
  trashed: boolean
}): FileAction {
  if (input.removed) return { kind: 'remove' }

  // Phase 1 indexes native Google Docs only. Anything else is counted and
  // skipped so "my file didn't appear" has an answer.
  if (input.mimeType !== MIME_DOCUMENT) return { kind: 'ignore', reason: 'not-a-doc' }

  if (input.trashed) return { kind: 'remove' }
  if (!input.isInScope) return { kind: 'remove' }

  return { kind: 'upsert' }
}

export type PartitionedChanges = {
  /** Changes carrying a folder payload. Must be applied FIRST. */
  folderChanges: { change: DriveChange; file: DriveFile }[]
  fileChanges: { change: DriveChange; file: DriveFile }[]
  /** removed:true carries no file payload, so we can't tell folder from file. */
  bareRemovals: string[]
}

/**
 * Split a change page, folders first.
 *
 * The ordering is load-bearing: applying folder changes before file changes
 * means `knownInScope` is already correct when each file in the same page is
 * evaluated, so a file whose parent folder moved in earlier in this very batch
 * resolves without an extra API call — and, more importantly, resolves
 * *correctly*.
 */
export function partitionChanges(changes: DriveChange[]): PartitionedChanges {
  const folderChanges: PartitionedChanges['folderChanges'] = []
  const fileChanges: PartitionedChanges['fileChanges'] = []
  const bareRemovals: string[] = []

  for (const change of changes) {
    // Drive also emits changeType 'drive' events for shared-drive metadata;
    // they carry no file and are not ours to act on.
    if (change.changeType && change.changeType !== 'file') continue

    const file = change.file
    if (!file?.id) {
      if (change.fileId) bareRemovals.push(change.fileId)
      continue
    }

    if (change.removed) {
      bareRemovals.push(file.id)
      continue
    }

    if (file.mimeType === MIME_FOLDER) folderChanges.push({ change, file })
    else fileChanges.push({ change, file })
  }

  return { folderChanges, fileChanges, bareRemovals }
}
