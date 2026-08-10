import { NextResponse, type NextRequest } from 'next/server'
import { OAuth2Client } from 'google-auth-library'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { googleAccounts, users } from '@/db/schema'
import {
  DRIVE_READONLY_SCOPE,
  OAUTH_COOKIE,
  openHandoff,
  safeReturnTo,
} from '@/lib/auth/oauth'
import {
  SESSION_COOKIE,
  issueSession,
  revokeSession,
  sessionCookieOptions,
} from '@/lib/auth/session'
import { encrypt, safeEqual } from '@/lib/crypto/secretbox'
import { env } from '@/lib/env'

/**
 * Leg 2 of the OAuth flow.
 *
 * Every failure below lands the user back on /connect with a machine-readable
 * `?e=` code rather than an error page — a failed connect is a state the connect
 * screen knows how to explain.
 */

type FailureCode =
  | 'denied' // user clicked cancel
  | 'oauth' // Google returned some other ?error=
  | 'expired' // handoff cookie missing or expired
  | 'state' // state mismatch — possible CSRF
  | 'exchange' // code -> token exchange failed
  | 'idtoken' // ID token missing or unverifiable
  | 'scope' // user unchecked Drive access on the consent screen
  | 'norefresh' // no refresh token and none on file

function fail(request: NextRequest, code: FailureCode) {
  const response = NextResponse.redirect(new URL(`/connect?e=${code}`, env.APP_URL))
  response.cookies.delete(OAUTH_COOKIE)
  return response
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams

  // 1. Google-side refusal.
  const oauthError = params.get('error')
  if (oauthError) {
    return fail(request, oauthError === 'access_denied' ? 'denied' : 'oauth')
  }

  const code = params.get('code')
  if (!code) return fail(request, 'oauth')

  // 2. Recover and verify the handoff.
  const sealed = request.cookies.get(OAUTH_COOKIE)?.value
  if (!sealed) return fail(request, 'expired')

  const handoff = await openHandoff(sealed)
  if (!handoff) return fail(request, 'expired')

  const returnedState = params.get('state')
  if (!returnedState || !safeEqual(returnedState, handoff.state)) {
    console.warn('[auth] OAuth state mismatch — request rejected')
    return fail(request, 'state')
  }

  // 3. Exchange the code, using the PKCE verifier that never left the server.
  const client = new OAuth2Client({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.googleRedirectUri,
  })

  let tokens
  try {
    const result = await client.getToken({ code, codeVerifier: handoff.verifier })
    tokens = result.tokens
  } catch (err) {
    // google-auth-library errors can carry the request body, which contains the
    // client secret and the code. Never let one reach a logger intact.
    console.error('[auth] Token exchange failed:', err instanceof Error ? err.message : 'unknown')
    return fail(request, 'exchange')
  }

  if (!tokens.id_token) return fail(request, 'idtoken')

  // 4. Verify the ID token rather than trusting its contents.
  let payload
  try {
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: env.GOOGLE_CLIENT_ID,
    })
    payload = ticket.getPayload()
  } catch (err) {
    console.error('[auth] ID token verification failed:', err instanceof Error ? err.message : 'unknown')
    return fail(request, 'idtoken')
  }

  if (!payload?.sub || !payload.email) return fail(request, 'idtoken')

  // 5. The consent screen lets a user uncheck individual scopes. Without Drive
  //    read access there is no product, so refuse rather than half-connecting.
  const grantedScopes = tokens.scope ?? ''
  if (!grantedScopes.split(' ').includes(DRIVE_READONLY_SCOPE)) {
    // Scopes are not secrets, and this is the only way to tell "the user
    // declined Drive" apart from "the scope was never configured on the consent
    // screen, so Google never asked for it".
    console.error(
      `[auth] drive.readonly was not granted.\n` +
        `       Google returned scope: ${grantedScopes || '(empty)'}\n` +
        `       If drive.readonly is absent entirely, check Google Auth Platform -> Data Access.`,
    )
    return fail(request, 'scope')
  }

  const googleSub = payload.sub
  const email = payload.email
  const emailVerified = payload.email_verified ?? false
  const displayName = payload.name ?? null
  const pictureUrl = payload.picture ?? null
  const now = new Date()

  const userId = await db.transaction(async (tx) => {
    // Upsert on google_sub — the stable identity key. Email is a display cache
    // and is refreshed here, never used to look anyone up.
    const [user] = await tx
      .insert(users)
      .values({
        googleSub,
        email,
        emailVerified,
        name: displayName,
        pictureUrl,
        lastLoginAt: now,
      })
      .onConflictDoUpdate({
        target: users.googleSub,
        set: { email, emailVerified, name: displayName, pictureUrl, lastLoginAt: now, updatedAt: now },
      })
      .returning({ id: users.id })

    const id = user!.id

    const refreshEnc = tokens.refresh_token
      ? encrypt(tokens.refresh_token, id, 'google_refresh_token')
      : null
    const accessEnc = tokens.access_token
      ? encrypt(tokens.access_token, id, 'google_access_token')
      : null
    const accessExpiry = tokens.expiry_date ? new Date(tokens.expiry_date) : null

    const existing = await tx
      .select({ refreshTokenEnc: googleAccounts.refreshTokenEnc })
      .from(googleAccounts)
      .where(eq(googleAccounts.userId, id))
      .limit(1)

    // If Google didn't return a refresh token this round, keep the one on file
    // rather than nulling it. If there's nothing on file either, we cannot do
    // background work at all, so bail loudly instead of connecting a dead account.
    if (!refreshEnc && !existing[0]?.refreshTokenEnc) {
      throw new NoRefreshTokenError()
    }

    await tx
      .insert(googleAccounts)
      .values({
        userId: id,
        provider: 'google',
        providerAccountId: googleSub,
        refreshTokenEnc: refreshEnc,
        accessTokenEnc: accessEnc,
        accessTokenExpiresAt: accessExpiry,
        grantedScopes,
        tokenStatus: 'active',
        tokenInvalidAt: null,
      })
      .onConflictDoUpdate({
        target: [googleAccounts.userId, googleAccounts.provider],
        set: {
          providerAccountId: googleSub,
          // COALESCE-by-hand: only overwrite when we actually got a new one.
          ...(refreshEnc ? { refreshTokenEnc: refreshEnc } : {}),
          accessTokenEnc: accessEnc,
          accessTokenExpiresAt: accessExpiry,
          grantedScopes,
          tokenStatus: 'active',
          tokenInvalidAt: null,
          updatedAt: now,
        },
      })

    return id
  }).catch((err: unknown) => {
    if (err instanceof NoRefreshTokenError) return null
    throw err
  })

  if (userId === null) return fail(request, 'norefresh')

  // 6. Account-switch guard: if a session already existed for a different user,
  //    revoke it. Never merge, never silently keep the old one.
  const priorToken = request.cookies.get(SESSION_COOKIE)?.value
  if (priorToken) await revokeSession(priorToken)

  const sessionToken = await issueSession(userId, request.headers.get('user-agent'))

  const response = NextResponse.redirect(
    new URL(safeReturnTo(handoff.returnTo), env.APP_URL),
  )
  response.cookies.set(SESSION_COOKIE, sessionToken, sessionCookieOptions)
  response.cookies.delete(OAUTH_COOKIE)
  return response
}

class NoRefreshTokenError extends Error {
  override readonly name = 'NoRefreshTokenError'
}
