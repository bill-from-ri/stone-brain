import type { TokenStatus } from '@/db/schema'

/**
 * What a sync run reports back.
 *
 * Note this carries `tokenStatus` and `error` rather than throwing: a dead Drive
 * grant is a designed state, not a crash (decisions §2), so /api/sync answers
 * HTTP 200 for every value below. The endpoint's contract is "here is the state
 * of the Drive connection", and "it's broken" is a valid state.
 */
export type SyncResult = {
  mode: 'initial' | 'incremental' | 'noop'

  /** Another invocation holds the lease. Not an error. */
  running?: true

  /** False means "call me again immediately" — budget hit, more work pending. */
  complete: boolean

  progress?: { foldersVisited: number; documentsSeen: number; queueRemaining: number }

  foldersUpserted: number
  foldersRemoved: number
  documentsUpserted: number
  documentsRemoved: number
  documentsRestored: number

  /** Slides, sheets, PDFs, shortcuts — counted so "nothing appeared" is explicable. */
  skippedNonDocs: number

  changesProcessed: number
  driveApiCalls: number

  /** Bumped on any write; lets the client decide whether to refetch. */
  syncSeq: number

  /**
   * Items whose containment could not be determined because Drive would not
   * answer. Deliberately NOT written and NOT treated as out-of-scope, so they
   * retry next run rather than vanishing silently.
   */
  deferred: { id: string; reason: string }[]

  tokenStatus: TokenStatus | 'unknown'
  lastSyncCompletedAt: string | null
  error?: { code: string; message: string }
  durationMs: number
}

export function emptyResult(mode: SyncResult['mode']): SyncResult {
  return {
    mode,
    complete: true,
    foldersUpserted: 0,
    foldersRemoved: 0,
    documentsUpserted: 0,
    documentsRemoved: 0,
    documentsRestored: 0,
    skippedNonDocs: 0,
    changesProcessed: 0,
    driveApiCalls: 0,
    syncSeq: 0,
    deferred: [],
    tokenStatus: 'active',
    lastSyncCompletedAt: null,
    durationMs: 0,
  }
}
