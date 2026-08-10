/**
 * Error taxonomy for everything that talks to Google.
 *
 * The point of these types is that a dead token is a *designed state*, not an
 * error path (decisions §2). Code that catches DriveAuthError is expected to
 * turn it into a UI state, not a 500. Nothing below ever carries a token or a
 * request body — google-auth-library errors sometimes do, which is exactly why
 * we re-throw as our own types before anything reaches a logger.
 */

export class DriveAuthError extends Error {
  override readonly name = 'DriveAuthError'
  constructor(
    readonly reason: 'invalid_grant' | 'revoked' | 'insufficient_scope' | 'not_connected',
    message?: string,
  ) {
    super(message ?? `Google authorization failed: ${reason}`)
  }
}

export class DriveRateLimitError extends Error {
  override readonly name = 'DriveRateLimitError'
  constructor(readonly retryAfterMs?: number) {
    super('Google Drive rate limit exceeded')
  }
}

export class DriveNotFoundError extends Error {
  override readonly name = 'DriveNotFoundError'
  constructor(readonly fileId: string) {
    // Drive returns 404 rather than 403 for resources an app has not been
    // granted, so this does NOT reliably mean "deleted" — see the spike in
    // spikes/drive-file-scope.
    super(`Drive returned notFound for ${fileId}`)
  }
}

export class DriveTransientError extends Error {
  override readonly name = 'DriveTransientError'
  constructor(
    readonly status: number,
    message?: string,
  ) {
    super(message ?? `Transient Drive failure (HTTP ${status})`)
  }
}

/**
 * The scope resolver said a file is outside the user's chosen root folder.
 *
 * Reaching this from a Library code path means a bug, not a user error: the
 * Library should never construct a request for an out-of-root file in the first
 * place. Reaching it from an API route means someone hand-crafted a request.
 */
export class OutOfScopeError extends Error {
  override readonly name = 'OutOfScopeError'
  constructor(readonly fileId: string) {
    super(`File ${fileId} is outside the configured root folder`)
  }
}

/** True for the shape google-auth-library / the token endpoint uses on a dead refresh token. */
export function isInvalidGrant(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { message?: string; response?: { data?: { error?: string } } }
  if (e.response?.data?.error === 'invalid_grant') return true
  return typeof e.message === 'string' && e.message.includes('invalid_grant')
}
