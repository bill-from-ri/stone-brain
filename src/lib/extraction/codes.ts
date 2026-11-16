import type { ProviderFailure } from '@/lib/llm/errors'
import type { ExtractionFailure } from '@/lib/llm/extract'

/**
 * The vocabulary a run reports in — shared by the server that records it and
 * the Extract button that explains it.
 *
 * Type-only imports and plain functions, so a client component can import this
 * without dragging `server-only` modules into the browser bundle.
 */

export type RunFailureCode =
  | ExtractionFailure
  | ProviderFailure
  | 'drive_disconnected'
  | 'drive_not_found'
  | 'drive_rate_limited'
  | 'drive_unavailable'
  /**
   * The row a run writes when it *starts* (see `beginRun`). A run that is
   * killed — a function timeout, a deploy, a crash — never reaches the update
   * that replaces it, so this is what it is remembered as.
   */
  | 'interrupted'
  | 'internal'

/** Why a run was refused before it began. None of these records a run. */
export type RunRefusal = 'not_found' | 'removed' | 'no_provider' | 'busy'

/** What `POST /api/documents/[id]/extract` returns for a run that happened. */
export type RunSummary = {
  runId: string
  documentId: string
  status: 'succeeded' | 'failed'
  failure: { code: RunFailureCode; message: string; retryAfterSeconds?: number } | null
  model: string | null
  attempts: number | null
  /** Claims that survived validation, before entity resolution. */
  claimsExtracted: number
  claimsCreated: number
  claimsAlreadyPresent: number
  /** Reverse-direction claims generated alongside (§5). */
  inversesCreated: number
  entitiesCreated: number
  /**
   * Existing claims a re-extraction retracted and this run removed — deleted,
   * or this document's citation withdrawn. Held retractions are not counted.
   */
  claimsRetracted: number
  /** Existing claims a re-extraction left standing. Zero on a first extraction. */
  claimsKept: number
  /** Claims the model emitted that did not reach the graph: validation plus write. */
  dropped: number
  /** Proposals filed into the queue by this run — after dedupe, so possibly fewer than proposed. */
  proposalsFiled: number
  durationMs: number
}

/** A failure that is the provider settings' fault, so the UI should offer the way to Settings. */
export function isProviderSettingsFailure(code: string | null | undefined): boolean {
  return code === 'unauthorized' || code === 'payment_required' || code === 'model_rejected'
}

/**
 * How long a run with no `finished_at` is presumed still alive.
 *
 * The route's `maxDuration` is 300s (ADR §8); a run older than twice that
 * cannot still be executing anywhere, so it is reported as interrupted and no
 * longer blocks a new attempt.
 */
export const RUN_LEASE_MS = 10 * 60_000
