import { NextResponse, type NextRequest } from 'next/server'
import {
  OAUTH_COOKIE,
  buildAuthorizationUrl,
  createPkce,
  createState,
  oauthCookieOptions,
  safeReturnTo,
  sealHandoff,
} from '@/lib/auth/oauth'
import { getSession } from '@/lib/auth/session'

/**
 * Leg 1 of the OAuth flow. Mints state + a PKCE pair, stashes them in a signed
 * short-lived cookie, and bounces to Google.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const returnTo = safeReturnTo(params.get('returnTo'))
  const isReconnect = params.get('reconnect') === '1'

  // On reconnect we know who they are, so steer Google at the same account —
  // reconnecting the wrong Google account is a confusing failure to recover from.
  let loginHint: string | undefined
  if (isReconnect) {
    const session = await getSession()
    loginHint = session?.user.email
  }

  const state = createState()
  const { verifier, challenge } = createPkce()

  const response = NextResponse.redirect(
    buildAuthorizationUrl({ state, challenge, loginHint }),
  )

  response.cookies.set(OAUTH_COOKIE, await sealHandoff({ state, verifier, returnTo }), oauthCookieOptions)

  return response
}
