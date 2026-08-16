import 'server-only'
import {
  DriveAuthError,
  DriveNotFoundError,
  DriveRateLimitError,
  DriveTransientError,
} from '@/lib/google/errors'
import { getAccessToken } from '@/lib/google/tokens'

/**
 * The single HTTP path to the Drive REST API.
 *
 * Deliberately `fetch` rather than the `googleapis` package: that pulls ~50MB of
 * generated code to call six endpoints, and its error objects carry the request
 * body (which includes the access token) into whatever logs them.
 *
 * Retry lives here rather than at call sites so every request gets it — a
 * per-caller retry is a per-caller opportunity to forget.
 */

const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const MAX_ATTEMPTS = 3
const BASE_BACKOFF_MS = 400

export type DriveCallStats = { apiCalls: number }

function jitteredBackoff(attempt: number): number {
  const ceiling = BASE_BACKOFF_MS * 2 ** (attempt - 1)
  // Full jitter: without it, concurrent retries re-collide in lockstep.
  return Math.random() * ceiling
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type DriveErrorBody = {
  error?: { code?: number; message?: string; errors?: { reason?: string }[] }
}

/**
 * Perform one authenticated Drive GET.
 *
 * `stats` is threaded through so a sync run can report how many API calls it
 * actually made — useful when reasoning about quota and about whether the scope
 * resolver's memo is doing its job.
 */
export async function driveGet<T>(
  userId: string,
  path: string,
  params: Record<string, string | undefined>,
  stats?: DriveCallStats,
  /**
   * `files.export` returns the document body, not JSON. Threading a mode
   * through here rather than writing a second fetch keeps every export on the
   * same retry, backoff and error-classification path as the rest of Drive —
   * an export is exactly as likely to hit a 429 as a list is.
   */
  responseType: 'json' | 'text' = 'json',
): Promise<T> {
  const url = new URL(`${DRIVE_API}${path}`)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value)
  }

  let lastTransient: Error | null = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const accessToken = await getAccessToken(userId)
    if (stats) stats.apiCalls++

    let response: Response
    try {
      response = await fetch(url, {
        headers: { authorization: `Bearer ${accessToken}` },
        // Drive data is per-user and mutable; caching it anywhere would be wrong.
        cache: 'no-store',
      })
    } catch (err) {
      lastTransient = new DriveTransientError(
        0,
        `Network failure calling Drive: ${err instanceof Error ? err.message : 'unknown'}`,
      )
      if (attempt < MAX_ATTEMPTS) {
        await sleep(jitteredBackoff(attempt))
        continue
      }
      throw lastTransient
    }

    if (response.ok) {
      return (responseType === 'text' ? await response.text() : await response.json()) as T
    }

    const body = (await response.json().catch(() => ({}))) as DriveErrorBody
    const reason = body.error?.errors?.[0]?.reason ?? ''
    const message = body.error?.message ?? response.statusText

    switch (response.status) {
      case 401:
        // The token was accepted when minted but is not now — treat as a dead
        // grant so it surfaces as the reconnect UI state rather than a 500.
        throw new DriveAuthError('invalid_grant', 'Drive rejected the access token')

      case 403:
        if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') {
          if (attempt < MAX_ATTEMPTS) {
            await sleep(jitteredBackoff(attempt))
            continue
          }
          throw new DriveRateLimitError()
        }
        if (reason === 'insufficientPermissions' || reason === 'insufficientFilePermissions') {
          throw new DriveAuthError('insufficient_scope', message)
        }
        throw new DriveTransientError(403, message)

      case 404:
        // Drive returns notFound rather than 403 for files an app cannot see, so
        // this does NOT reliably mean "deleted". The spike in
        // spikes/drive-file-scope demonstrated exactly this.
        throw new DriveNotFoundError(extractFileId(path))

      case 429:
        if (attempt < MAX_ATTEMPTS) {
          const retryAfter = Number(response.headers.get('retry-after'))
          await sleep(
            Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter * 1000
              : jitteredBackoff(attempt),
          )
          continue
        }
        throw new DriveRateLimitError()

      default:
        if (response.status >= 500) {
          lastTransient = new DriveTransientError(response.status, message)
          if (attempt < MAX_ATTEMPTS) {
            await sleep(jitteredBackoff(attempt))
            continue
          }
          throw lastTransient
        }
        throw new DriveTransientError(response.status, message)
    }
  }

  throw lastTransient ?? new DriveTransientError(0, 'Drive request failed after retries')
}

function extractFileId(path: string): string {
  return decodeURIComponent(path.split('/').filter(Boolean).pop() ?? path)
}

/**
 * Escape a value for use inside a Drive `q` string literal.
 *
 * Drive's query grammar delimits string literals with single quotes and escapes
 * with backslashes. A folder named `Bob's Notes` breaks an unescaped query, and
 * search terms come from user input.
 */
export function escapeQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}
