import { describe, expect, it } from 'vitest'
import { classifyFileChange, classifyFolderChange, partitionChanges } from './changes'
import { MIME_DOCUMENT, MIME_FOLDER } from '@/lib/drive/fields'
import type { DriveChange } from '@/lib/drive/types'

describe('classifyFolderChange — the transition table', () => {
  // The case that makes folder moves hard: Drive reports ONE event, but the
  // scope of the entire subtree changed and Drive will never enumerate it.
  it('out -> in queues a subtree crawl, because Drive will not enumerate it', () => {
    expect(
      classifyFolderChange({ wasKnown: false, isInScope: true, removed: false, trashed: false }),
    ).toEqual({ kind: 'upsert-and-crawl' })
  })

  it('in -> out cascades a removal from our own mirror', () => {
    expect(
      classifyFolderChange({ wasKnown: true, isInScope: false, removed: false, trashed: false }),
    ).toEqual({ kind: 'cascade-remove' })
  })

  it('in -> in is a plain upsert (rename or move within the root)', () => {
    expect(
      classifyFolderChange({ wasKnown: true, isInScope: true, removed: false, trashed: false }),
    ).toEqual({ kind: 'upsert' })
  })

  it('out -> out is ignored', () => {
    expect(
      classifyFolderChange({ wasKnown: false, isInScope: false, removed: false, trashed: false }),
    ).toEqual({ kind: 'ignore' })
  })

  it('trashing a known folder cascades', () => {
    expect(
      classifyFolderChange({ wasKnown: true, isInScope: true, removed: false, trashed: true }),
    ).toEqual({ kind: 'cascade-remove' })
  })

  it('hard-deleting a known folder cascades', () => {
    expect(
      classifyFolderChange({ wasKnown: true, isInScope: true, removed: true, trashed: false }),
    ).toEqual({ kind: 'cascade-remove' })
  })

  it('never cascades a folder we never had — that would be a no-op write storm', () => {
    expect(
      classifyFolderChange({ wasKnown: false, isInScope: false, removed: true, trashed: false }),
    ).toEqual({ kind: 'ignore' })
    expect(
      classifyFolderChange({ wasKnown: false, isInScope: true, removed: false, trashed: true }),
    ).toEqual({ kind: 'ignore' })
  })
})

describe('classifyFileChange', () => {
  const doc = { mimeType: MIME_DOCUMENT, isInScope: true, removed: false, trashed: false }

  it('upserts an in-scope Google Doc', () => {
    expect(classifyFileChange(doc)).toEqual({ kind: 'upsert' })
  })

  it('removes a doc that left the root', () => {
    expect(classifyFileChange({ ...doc, isInScope: false })).toEqual({ kind: 'remove' })
  })

  it('removes a trashed doc', () => {
    expect(classifyFileChange({ ...doc, trashed: true })).toEqual({ kind: 'remove' })
  })

  it('removes a hard-deleted file regardless of type', () => {
    expect(classifyFileChange({ ...doc, removed: true })).toEqual({ kind: 'remove' })
    expect(
      classifyFileChange({ mimeType: 'application/pdf', isInScope: true, removed: true, trashed: false }),
    ).toEqual({ kind: 'remove' })
  })

  // Phase 1 is Google Docs only; everything else is counted, not silently dropped.
  it('skips non-Docs and says why', () => {
    for (const mime of [
      'application/vnd.google-apps.spreadsheet',
      'application/vnd.google-apps.presentation',
      'application/vnd.google-apps.shortcut',
      'application/pdf',
      undefined,
    ]) {
      expect(classifyFileChange({ ...doc, mimeType: mime })).toEqual({
        kind: 'ignore',
        reason: 'not-a-doc',
      })
    }
  })
})

describe('partitionChanges', () => {
  const folder = (id: string): DriveChange => ({
    changeType: 'file',
    fileId: id,
    file: { id, mimeType: MIME_FOLDER, name: id },
  })
  const file = (id: string): DriveChange => ({
    changeType: 'file',
    fileId: id,
    file: { id, mimeType: MIME_DOCUMENT, name: id },
  })

  it('separates folders from files so folders can be applied first', () => {
    const result = partitionChanges([file('f1'), folder('d1'), file('f2'), folder('d2')])
    expect(result.folderChanges.map((c) => c.file.id)).toEqual(['d1', 'd2'])
    expect(result.fileChanges.map((c) => c.file.id)).toEqual(['f1', 'f2'])
  })

  it('collects removals, which carry no file payload at all', () => {
    const result = partitionChanges([
      { changeType: 'file', fileId: 'gone1', removed: true },
      { changeType: 'file', fileId: 'gone2', removed: true, file: { id: 'gone2' } },
      file('alive'),
    ])
    expect(result.bareRemovals).toEqual(['gone1', 'gone2'])
    expect(result.fileChanges.map((c) => c.file.id)).toEqual(['alive'])
  })

  it('ignores shared-drive metadata changes, which are not ours to act on', () => {
    const result = partitionChanges([
      { changeType: 'drive', driveId: 'sd1' },
      file('f1'),
    ])
    expect(result.fileChanges).toHaveLength(1)
    expect(result.folderChanges).toHaveLength(0)
    expect(result.bareRemovals).toHaveLength(0)
  })

  it('drops a change with neither a file nor a fileId rather than throwing', () => {
    expect(() => partitionChanges([{ changeType: 'file' }])).not.toThrow()
    expect(partitionChanges([{ changeType: 'file' }]).bareRemovals).toEqual([])
  })
})
