import { DriveAuthError, DriveNotFoundError, DriveRateLimitError, DriveTransientError, OutOfScopeError } from '@/lib/google/errors'
import { ProviderError, type ProviderFailure } from '@/lib/llm/errors'
import { ExtractionError } from '@/lib/llm/extract'
import type { RunFailureCode } from './codes'

/**
 * Why a run failed, as a code a program can branch on and a sentence a person
 * can act on.
 *
 * Every thrown thing a run can meet ends up here, because a failed run is
 * *recorded* (`extraction_runs.failure_code` / `failure_message`) rather than
 * surfaced as a 500: the Library has to be able to say "the last attempt on
 * this document failed, and here is why" long after the request that tried it
 * is gone. So the sentence is written for the person reading the detail pane,
 * not for a log.
 *
 * Pure and dependency-light on purpose — the codes are the API's contract with
 * the Extract button, and the button's copy is tested against them.
 */

export type RunFailure = {
  code: RunFailureCode
  message: string
  /** From the provider's `retry-after`, when it sent one. */
  retryAfterSeconds?: number
}

export const INTERRUPTED_MESSAGE =
  'The extraction did not finish — the server stopped before the model replied. Nothing was written.'

const PROVIDER_LEAD: Record<ProviderFailure, string> = {
  unauthorized: 'Your provider rejected the API key.',
  payment_required: 'Your provider account is out of credit.',
  rate_limited: 'Your provider is rate limiting requests.',
  model_rejected:
    'Your provider refused the request — most often because it does not serve that model ID.',
  unreachable: 'Could not reach your provider, or it is temporarily unavailable.',
}

export function describeFailure(err: unknown): RunFailure {
  // Already written for a person — see the messages in extract.ts.
  if (err instanceof ExtractionError) return { code: err.code, message: err.message }

  if (err instanceof ProviderError) {
    const lead = PROVIDER_LEAD[err.reason]
    const wait =
      err.reason === 'rate_limited' && err.retryAfterSeconds !== undefined
        ? ` Try again in ${formatWait(err.retryAfterSeconds)}.`
        : err.reason === 'rate_limited'
          ? ' Try again later.'
          : ''
    // `detail` is safe to store and show by construction (see errors.ts), and
    // is often the one fact that says which field to fix.
    const detail = err.detail && err.detail !== lead ? ` (${err.detail})` : ''
    return {
      code: err.reason,
      message: `${lead}${wait}${detail}`,
      ...(err.retryAfterSeconds !== undefined && { retryAfterSeconds: err.retryAfterSeconds }),
    }
  }

  if (err instanceof DriveAuthError) {
    return {
      code: 'drive_disconnected',
      message: 'Stone Brain could not read this document from Google Drive. Reconnect Drive and try again.',
    }
  }
  if (err instanceof DriveNotFoundError || err instanceof OutOfScopeError) {
    return {
      code: 'drive_not_found',
      message: 'Google Drive no longer has this document where Stone Brain expects it. Sync Drive and try again.',
    }
  }
  if (err instanceof DriveRateLimitError) {
    return {
      code: 'drive_rate_limited',
      message: 'Google Drive is rate limiting requests. Try again in a minute.',
    }
  }
  if (err instanceof DriveTransientError) {
    return {
      code: 'drive_unavailable',
      message: 'Google Drive did not answer. Try again in a minute.',
    }
  }

  return {
    code: 'internal',
    message: 'Something went wrong on Stone Brain’s side. Nothing was written.',
  }
}

function formatWait(seconds: number): string {
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} seconds`
  const minutes = Math.round(seconds / 60)
  return minutes < 90 ? `${minutes} minutes` : `${Math.round(minutes / 60)} hours`
}
