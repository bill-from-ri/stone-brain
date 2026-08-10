import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import { env } from '@/lib/env'

/**
 * The short-lived handoff between the two legs of the OAuth flow.
 *
 * State and the PKCE verifier live in a signed cookie rather than a DB row: it
 * works before a users row exists, is naturally scoped to the one browser that
 * started the flow, can't leak across users, and leaves nothing to garbage
 * collect. The only thing a DB row would buy — surviving a cookie wipe
 * mid-flow — is not a case worth supporting.
 */

export const OAUTH_COOKIE = 'sb_oauth'
const OAUTH_TTL_SECONDS = 600

const secret = new TextEncoder().encode(env.SESSION_SECRET)

export type OAuthHandoff = {
  state: string
  verifier: string
  returnTo: string
}

export type PkcePair = { verifier: string; challenge: string }

export function createPkce(): PkcePair {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export function createState(): string {
  return randomBytes(32).toString('base64url')
}

export async function sealHandoff(handoff: OAuthHandoff): Promise<string> {
  return new SignJWT({ ...handoff })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${OAUTH_TTL_SECONDS}s`)
    .sign(secret)
}

export async function openHandoff(jws: string): Promise<OAuthHandoff | null> {
  try {
    const { payload } = await jwtVerify(jws, secret)
    const { state, verifier, returnTo } = payload as Partial<OAuthHandoff>
    if (typeof state !== 'string' || typeof verifier !== 'string') return null
    return { state, verifier, returnTo: typeof returnTo === 'string' ? returnTo : '/' }
  } catch {
    // Expired or tampered. Indistinguishable to the caller on purpose.
    return null
  }
}

export const oauthCookieOptions = {
  httpOnly: true,
  secure: env.isProduction,
  sameSite: 'lax',
  // Scoped to the auth routes: no other part of the app has any business
  // reading the PKCE verifier.
  path: '/api/auth',
  maxAge: OAUTH_TTL_SECONDS,
} as const

/**
 * Open-redirect guard. Only same-site absolute paths are allowed back.
 * Rejects `//evil.com` and `https://evil.com`, both of which a browser would
 * happily treat as off-site.
 */
export function safeReturnTo(raw: string | null | undefined, fallback = '/'): string {
  if (!raw) return fallback
  if (!raw.startsWith('/')) return fallback
  if (raw.startsWith('//')) return fallback
  return raw
}

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.readonly',
] as const

export const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'

export function buildAuthorizationUrl(opts: {
  state: string
  challenge: string
  loginHint?: string | undefined
}): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', env.GOOGLE_CLIENT_ID)
  url.searchParams.set('redirect_uri', env.googleRedirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', GOOGLE_SCOPES.join(' '))

  // Required for a refresh token to be issued at all.
  url.searchParams.set('access_type', 'offline')

  // Required for a refresh token on RE-authorization. Google returns one only on
  // the consent grant; a silent re-auth of an already-consented app returns an
  // access token with none. Set unconditionally rather than detecting the absence
  // and retrying — that is more code guarding a worse invariant, and one extra
  // consent click is arguably correct for an app requesting a restricted scope.
  url.searchParams.set('prompt', 'consent')

  // Incremental auth, so adding drive.file in Phase 4 doesn't drop drive.readonly.
  url.searchParams.set('include_granted_scopes', 'true')

  url.searchParams.set('state', opts.state)
  url.searchParams.set('code_challenge', opts.challenge)
  url.searchParams.set('code_challenge_method', 'S256')

  // On reconnect, steer the user back to the account they already connected.
  if (opts.loginHint) url.searchParams.set('login_hint', opts.loginHint)

  return url.toString()
}
