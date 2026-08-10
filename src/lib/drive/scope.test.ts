import { describe, expect, it, vi } from 'vitest'
import { MAX_ANCESTRY_DEPTH, ScopeResolver, ScopeUndeterminedError } from './scope'
import type { DriveFile } from './types'

/**
 * A fake Drive: a flat map of id -> parents. No network, no module mocking.
 *
 * Tree used by most tests:
 *   root ── a ── b ── deepDoc
 *        └─ docInRoot
 *   outsideFolder ── docOutside
 */
function fakeDrive(files: Record<string, Partial<DriveFile>>) {
  const calls: string[] = []
  const getFile = vi.fn(async (id: string): Promise<DriveFile> => {
    calls.push(id)
    const f = files[id]
    if (!f) throw new Error(`notFound: ${id}`)
    return { id, ...f }
  })
  return { getFile, calls }
}

const TREE: Record<string, Partial<DriveFile>> = {
  root: { name: 'Nevlos', parents: ['myDriveTop'] },
  a: { name: 'History', parents: ['root'] },
  b: { name: 'Wars', parents: ['a'] },
  outsideFolder: { name: 'Outside', parents: ['myDriveTop'] },
  myDriveTop: { name: 'My Drive' }, // no parents — top of Drive
}

function make(files = TREE, knownInScope: string[] = [], rootDriveId?: string) {
  const drive = fakeDrive(files)
  const resolver = new ScopeResolver({
    rootId: 'root',
    knownInScope,
    getFile: drive.getFile,
    ...(rootDriveId ? { rootDriveId } : {}),
  })
  return { resolver, drive }
}

describe('ScopeResolver', () => {
  it('treats the root itself as in scope', async () => {
    const { resolver, drive } = make()
    await expect(resolver.resolve({ id: 'root' })).resolves.toBe('in')
    expect(drive.getFile).not.toHaveBeenCalled()
  })

  it('accepts a file whose parent is the root, with no API call', async () => {
    const { resolver, drive } = make()
    await expect(resolver.resolve({ id: 'docInRoot', parents: ['root'] })).resolves.toBe('in')
    expect(drive.getFile).not.toHaveBeenCalled()
  })

  it('accepts a file whose parent is a known mirrored folder, with no API call', async () => {
    const { resolver, drive } = make(TREE, ['a', 'b'])
    await expect(resolver.resolve({ id: 'doc', parents: ['b'] })).resolves.toBe('in')
    expect(drive.getFile).not.toHaveBeenCalled()
  })

  // The case the whole ancestry walk exists for: a subfolder created since the
  // last sync, so its id is in nobody's mirror yet.
  it('walks up an unknown parent chain and finds the root', async () => {
    const { resolver, drive } = make()
    await expect(resolver.resolve({ id: 'deepDoc', parents: ['b'] })).resolves.toBe('in')
    expect(drive.calls).toEqual(['b', 'a']) // stops as soon as it hits root
  })

  it('walks up an unknown chain and correctly rejects a file outside the root', async () => {
    const { resolver } = make()
    await expect(
      resolver.resolve({ id: 'docOutside', parents: ['outsideFolder'] }),
    ).resolves.toBe('out')
  })

  it('rejects a parentless orphan', async () => {
    const { resolver } = make()
    await expect(resolver.resolve({ id: 'orphan', parents: [] })).resolves.toBe('out')
    await expect(resolver.resolve({ id: 'orphan2' })).resolves.toBe('out')
  })

  it('rejects a file in a different shared drive', async () => {
    const { resolver } = make(TREE, [], 'sharedDriveA')
    await expect(
      resolver.resolve({ id: 'doc', parents: ['whatever'], driveId: 'sharedDriveB' }),
    ).resolves.toBe('out')
  })

  it('accepts a legacy multi-parent file if ANY parent is in scope', async () => {
    const { resolver } = make(TREE, ['a'])
    await expect(
      resolver.resolve({ id: 'doc', parents: ['outsideFolder', 'a'] }),
    ).resolves.toBe('in')
  })

  /**
   * The important failure-mode test. A transient Drive failure must not be
   * silently recorded as "out of scope" — that would permanently drop a
   * legitimate document from the Library with no way to notice.
   */
  it('throws ScopeUndeterminedError when Drive will not answer, and does not memoize', async () => {
    const drive = fakeDrive(TREE)
    let fail = true
    const flaky = vi.fn(async (id: string) => {
      if (fail && id === 'b') throw new Error('503 backend error')
      return drive.getFile(id)
    })
    const resolver = new ScopeResolver({ rootId: 'root', knownInScope: [], getFile: flaky })

    await expect(resolver.resolve({ id: 'doc', parents: ['b'] })).rejects.toBeInstanceOf(
      ScopeUndeterminedError,
    )

    // Retry on the next run, once Drive recovers, must succeed — proving the
    // failure was not cached as a negative verdict.
    fail = false
    await expect(resolver.resolve({ id: 'doc', parents: ['b'] })).resolves.toBe('in')
  })

  it('fails closed at the depth cap and warns', async () => {
    // A chain longer than the cap that never reaches root.
    const deep: Record<string, Partial<DriveFile>> = { root: { parents: [] } }
    for (let i = 0; i < MAX_ANCESTRY_DEPTH + 5; i++) {
      deep[`n${i}`] = { parents: [`n${i + 1}`] }
    }
    deep[`n${MAX_ANCESTRY_DEPTH + 5}`] = { parents: [] }

    const drive = fakeDrive(deep)
    const onWarn = vi.fn()
    const resolver = new ScopeResolver({
      rootId: 'root',
      knownInScope: [],
      getFile: drive.getFile,
      onWarn,
    })

    await expect(resolver.resolve({ id: 'leaf', parents: ['n0'] })).resolves.toBe('out')
    expect(onWarn).toHaveBeenCalledOnce()
    expect(onWarn.mock.calls[0]![0]).toMatch(/exceeded 20 levels/)
  })

  it('memoizes the whole visited path, so a sibling costs no API calls', async () => {
    const { resolver, drive } = make()

    await expect(resolver.resolve({ id: 'doc1', parents: ['b'] })).resolves.toBe('in')
    const afterFirst = drive.getFile.mock.calls.length
    expect(afterFirst).toBe(2)

    // Second file in the same new subfolder: fully served from the memo.
    await expect(resolver.resolve({ id: 'doc2', parents: ['b'] })).resolves.toBe('in')
    expect(drive.getFile.mock.calls.length).toBe(afterFirst)
  })

  it('memoizes negative verdicts too', async () => {
    const { resolver, drive } = make()

    await expect(resolver.resolve({ id: 'x1', parents: ['outsideFolder'] })).resolves.toBe('out')
    const afterFirst = drive.getFile.mock.calls.length

    await expect(resolver.resolve({ id: 'x2', parents: ['outsideFolder'] })).resolves.toBe('out')
    expect(drive.getFile.mock.calls.length).toBe(afterFirst)
  })

  // This is what makes folder-before-file ordering within a changes page work.
  it('markInScope lets a file resolve without an API call after its folder moves in', async () => {
    const { resolver, drive } = make()

    resolver.markInScope('newlyMovedIn')
    await expect(resolver.resolve({ id: 'doc', parents: ['newlyMovedIn'] })).resolves.toBe('in')
    expect(drive.getFile).not.toHaveBeenCalled()
  })

  it('markOutOfScope flips a previously known folder', async () => {
    const { resolver } = make(TREE, ['a'])
    await expect(resolver.resolve({ id: 'doc', parents: ['a'] })).resolves.toBe('in')

    resolver.markOutOfScope('a')
    await expect(resolver.resolve({ id: 'other', parents: ['a'] })).resolves.toBe('out')
  })

  describe('resolveFolder', () => {
    it('accepts the root and known folders with no API call', async () => {
      const { resolver, drive } = make(TREE, ['a'])
      await expect(resolver.resolveFolder('root')).resolves.toBe('in')
      await expect(resolver.resolveFolder('a')).resolves.toBe('in')
      expect(drive.getFile).not.toHaveBeenCalled()
    })

    it('walks up to accept an unknown folder that is under the root', async () => {
      const { resolver } = make()
      await expect(resolver.resolveFolder('b')).resolves.toBe('in')
    })

    it('rejects an unknown folder outside the root', async () => {
      const { resolver } = make()
      await expect(resolver.resolveFolder('outsideFolder')).resolves.toBe('out')
    })

    // resolve() with no parents means "orphan" and is correctly 'out'; a folder
    // must start its own walk instead. This is the distinction the method exists for.
    it('differs from resolve() for a bare in-scope folder id', async () => {
      const { resolver } = make()
      await expect(resolver.resolve({ id: 'b' })).resolves.toBe('out')

      const fresh = make().resolver
      await expect(fresh.resolveFolder('b')).resolves.toBe('in')
    })
  })

  it('counts ancestry API calls for quota reporting', async () => {
    const { resolver } = make()
    expect(resolver.ancestryApiCalls).toBe(0)
    await resolver.resolve({ id: 'doc', parents: ['b'] })
    expect(resolver.ancestryApiCalls).toBe(2)
  })
})
