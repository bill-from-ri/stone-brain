import { describe, expect, it } from 'vitest'
import type { AttentionDocument, DocumentMix, RecentRun } from '@/db/queries/home'
import {
  MAX_NEXT_STEPS,
  buildActivity,
  buildNextSteps,
  documentHref,
  emptyNextSteps,
  summarize,
  timeAgo,
  type HomeState,
} from './model'

const MIX: DocumentMix = {
  total: 0,
  verified: 0,
  extracted: 0,
  notExtracted: 0,
  changedSinceExtraction: 0,
}

function state(over: Partial<HomeState> = {}, mix: Partial<DocumentMix> = {}): HomeState {
  return {
    mix: { ...MIX, ...mix },
    claimCount: 0,
    openConflicts: 0,
    attention: [],
    provider: { health: 'ok' },
    sync: { initialCrawlDone: true, lastSyncCompletedAt: null, lastSyncError: null },
    ...over,
  }
}

function doc(reason: AttentionDocument['reason'], name: string): AttentionDocument {
  return {
    reason,
    driveFileId: `drive-${name}`,
    name,
    parentDriveFolderId: 'folder-1',
    folderName: 'History',
    modifiedTime: null,
  }
}

function run(over: Partial<RecentRun> = {}): RecentRun {
  return {
    id: 'run-1',
    status: 'succeeded',
    startedAt: new Date('2026-11-10T10:00:00Z'),
    finishedAt: new Date('2026-11-10T10:01:00Z'),
    failureMessage: null,
    claimsCreated: 12,
    claimsAlreadyPresent: 0,
    inversesCreated: 0,
    documentName: 'The Varrow Succession',
    driveFileId: 'drive-1',
    parentDriveFolderId: 'folder-1',
    documentRemoved: false,
    ...over,
  }
}

describe('documentHref', () => {
  it('opens the document in the folder view that lists it', () => {
    expect(documentHref({ driveFileId: 'a b', parentDriveFolderId: 'f1' })).toBe(
      '/library/f1?doc=a%20b',
    )
  })

  it('falls back to the Library root for an orphan', () => {
    expect(documentHref({ driveFileId: 'x', parentDriveFolderId: null })).toBe('/library')
  })
})

describe('buildNextSteps', () => {
  it('puts open conflicts first', () => {
    const steps = buildNextSteps(
      state({ openConflicts: 2, attention: [doc('changed', 'A')] }, { changedSinceExtraction: 1 }),
    )
    expect(steps[0]).toMatchObject({ key: 'conflicts', title: '2 open conflicts', href: '/conflicts' })
    expect(steps[1]?.key).toBe('changed:drive-A')
  })

  it('orders documents changed, then never extracted, then unverified', () => {
    const steps = buildNextSteps(
      state({
        attention: [doc('unverified', 'C'), doc('not_extracted', 'B'), doc('changed', 'A')],
      }),
    )
    expect(steps.map((s) => s.title)).toEqual(['A', 'B', 'C'])
  })

  it('points to Settings instead of extraction when no provider is configured', () => {
    const steps = buildNextSteps(
      state(
        { provider: null, attention: [doc('not_extracted', 'B'), doc('unverified', 'C')] },
        { notExtracted: 3 },
      ),
    )
    expect(steps[0]).toMatchObject({ key: 'provider', href: '/settings' })
    expect(steps[0]?.detail).toContain('3 documents are waiting')
    // Nothing suggests extracting a document that cannot be extracted…
    expect(steps.some((s) => s.key.startsWith('not_extracted:'))).toBe(false)
    // …but verifying needs no provider.
    expect(steps.some((s) => s.key === 'unverified:drive-C')).toBe(true)
  })

  it('treats a provider whose last check failed like a missing one', () => {
    const steps = buildNextSteps(
      state(
        { provider: { health: 'unauthorized' }, attention: [doc('changed', 'A')] },
        { changedSinceExtraction: 1 },
      ),
    )
    expect(steps.map((s) => s.key)).toEqual(['provider'])
    expect(steps[0]?.title).toBe('Your model provider needs attention')
  })

  it('does not nag about the provider when there is nothing to extract', () => {
    expect(buildNextSteps(state({ provider: null }, { total: 4, extracted: 4 }))).toEqual([])
  })

  it('treats an unprobed provider as usable', () => {
    const steps = buildNextSteps(
      state({ provider: { health: 'unknown' }, attention: [doc('not_extracted', 'B')] }),
    )
    expect(steps.map((s) => s.key)).toEqual(['not_extracted:drive-B'])
  })

  it('caps the list', () => {
    const attention = ['A', 'B', 'C'].flatMap((n) => [
      doc('changed', n),
      doc('not_extracted', `${n}2`),
    ])
    const steps = buildNextSteps(state({ openConflicts: 1, attention }))
    expect(steps).toHaveLength(MAX_NEXT_STEPS)
    expect(steps[0]?.title).toBe('One open conflict')
  })
})

describe('emptyNextSteps', () => {
  it('is null when there is something to suggest', () => {
    const s = state({ openConflicts: 1 })
    expect(emptyNextSteps(s, buildNextSteps(s))).toBeNull()
  })

  it('distinguishes a first crawl in progress from an empty folder', () => {
    const crawling = state({
      sync: { initialCrawlDone: false, lastSyncCompletedAt: null, lastSyncError: null },
    })
    expect(emptyNextSteps(crawling, [])?.title).toBe('The first sync is still running')
    expect(emptyNextSteps(state(), [])).toMatchObject({
      title: 'No documents yet',
      action: { href: '/library' },
    })
  })

  it('says so when everything is done', () => {
    expect(emptyNextSteps(state({}, { total: 3, extracted: 3 }), [])?.title).toBe('Nothing waiting')
  })
})

describe('summarize', () => {
  it('lists what is pending, most pressing first', () => {
    expect(
      summarize(state({ openConflicts: 1 }, { total: 9, changedSinceExtraction: 2, notExtracted: 3 })),
    ).toBe('1 open conflict, 2 documents changed since extraction and 3 documents not yet extracted.')
  })

  it('handles the empty and the finished library', () => {
    expect(summarize(state())).toBe('Nothing has been mirrored from your folder yet.')
    expect(summarize(state({}, { total: 2, extracted: 2, verified: 1 }))).toBe(
      'Every document is extracted and current.',
    )
    expect(summarize(state({}, { total: 2, extracted: 2, verified: 2 }))).toBe(
      'Every document is extracted, current, and verified.',
    )
  })
})

describe('buildActivity', () => {
  it('describes a successful run by what it wrote', () => {
    const [item] = buildActivity(
      [run({ claimsCreated: 12, claimsAlreadyPresent: 3, inversesCreated: 1 })],
      null,
    )
    expect(item).toMatchObject({
      lead: 'Extracted',
      subject: 'The Varrow Succession',
      detail: '12 new claims, 3 already in the graph, 1 inverse',
      href: '/library/folder-1?doc=drive-1',
    })
  })

  it('shows a failed run with its message', () => {
    const [item] = buildActivity(
      [run({ status: 'failed', failureMessage: 'The provider rejected the key.' })],
      null,
    )
    expect(item).toMatchObject({
      lead: 'Extraction failed:',
      tone: 'bad',
      detail: 'The provider rejected the key.',
    })
  })

  it('does not link a run whose document has left the Library', () => {
    expect(buildActivity([run({ documentRemoved: true })], null)[0]?.href).toBeUndefined()
  })

  it('merges the last sync in by time, newest first', () => {
    const items = buildActivity(
      [
        run({ id: 'old', finishedAt: new Date('2026-11-01T00:00:00Z') }),
        run({ id: 'new', finishedAt: new Date('2026-11-10T00:00:00Z') }),
      ],
      { initialCrawlDone: true, lastSyncCompletedAt: '2026-11-05T00:00:00Z', lastSyncError: null },
    )
    expect(items.map((i) => i.key)).toEqual(['new', 'sync', 'old'])
  })

  it('adds no sync entry for a folder that has never finished syncing', () => {
    expect(
      buildActivity([], { initialCrawlDone: false, lastSyncCompletedAt: null, lastSyncError: null }),
    ).toEqual([])
  })
})

describe('timeAgo', () => {
  const now = new Date('2026-11-11T12:00:00Z')
  const ago = (ms: number) => timeAgo(new Date(now.getTime() - ms), now)

  it('uses the compact forms', () => {
    expect(ago(20_000)).toBe('just now')
    expect(ago(4 * 60_000)).toBe('4 min ago')
    expect(ago(3 * 3_600_000)).toBe('3h ago')
    expect(ago(2 * 86_400_000)).toBe('2d ago')
    expect(ago(65 * 86_400_000)).toBe('2mo ago')
  })

  it('never reports the future', () => {
    expect(timeAgo(new Date(now.getTime() + 60_000), now)).toBe('just now')
  })
})
