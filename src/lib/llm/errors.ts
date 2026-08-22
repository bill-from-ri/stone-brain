import type { ProviderHealth } from '@/db/schema'

/**
 * Error taxonomy for the user's own inference provider.
 *
 * Same principle as Google's in src/lib/google/errors.ts: these are *designed
 * states*, not error paths (decisions §11 names four of them by hand — missing
 * key, revoked, out of credit, rate limited). Code that catches ProviderError
 * turns it into a connection state, not a 500.
 *
 * `reason` maps one-to-one onto `ProviderHealth`, minus `unknown` and `ok`,
 * which are not failures and so have no error to carry them.
 */

export type ProviderFailure = Exclude<ProviderHealth, 'unknown' | 'ok'>

export class ProviderError extends Error {
  override readonly name = 'ProviderError'
  constructor(
    readonly reason: ProviderFailure,
    /**
     * One short sentence, safe to store and to show. Built by `describe()` or
     * by `safeDetail()` — never a raw provider body, and never the key.
     */
    readonly detail: string,
    /** Present when the provider answered at all. */
    readonly status?: number,
    /** Seconds, from `retry-after`, when the provider offered one. */
    readonly retryAfterSeconds?: number,
  ) {
    super(`${reason}: ${detail}`)
  }
}

/**
 * Classify a non-2xx response from an OpenAI-compatible endpoint.
 *
 * The three status codes §11 calls out are load-bearing and get their own
 * states. Everything else that is a 4xx is the request's fault, and by far the
 * likeliest cause is a model ID this provider does not serve — that is the one
 * field of the three we cannot validate by shape.
 */
export function classifyStatus(status: number): ProviderFailure {
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === 402) return 'payment_required'
  if (status === 429) return 'rate_limited'
  if (status >= 400 && status < 500) return 'model_rejected'
  return 'unreachable'
}

/**
 * Pull a usable sentence out of a provider's error body.
 *
 * Providers are not consistent about the shape, so this tries the two common
 * ones and gives up gracefully. Three rules, all of them about what must *not*
 * come back: the key never appears (it is redacted even though no provider
 * should be echoing it), the result is bounded so a provider cannot write a
 * novel into our database, and control characters are stripped so the string is
 * safe to put in a log line.
 */
export function safeDetail(body: string, apiKey: string, fallback: string): string {
  let message = ''

  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string } | string
      message?: string
      detail?: string
    }
    if (typeof parsed.error === 'string') message = parsed.error
    else if (typeof parsed.error?.message === 'string') message = parsed.error.message
    else if (typeof parsed.message === 'string') message = parsed.message
    else if (typeof parsed.detail === 'string') message = parsed.detail
  } catch {
    // Not JSON — an HTML error page from a proxy, most likely. Its text is not
    // worth showing, so fall through to the fallback rather than dumping markup.
  }

  message = message.trim()
  if (!message) return fallback

  const clean = message.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  const redacted = apiKey.length >= 8 ? clean.split(apiKey).join('****') : clean

  return redacted.length > 240 ? `${redacted.slice(0, 239)}…` : redacted
}
