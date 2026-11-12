import { NextResponse, type NextRequest } from 'next/server'

/**
 * Cookie presence only. No database, no session validation.
 *
 * This is a UX fast path that avoids rendering a page the user is about to be
 * bounced off — it is NOT the security boundary. Next's own docs warn to
 * "always verify authentication and authorization inside each Server Function
 * rather than relying on Proxy alone", and a gate whose coverage depends on the
 * matcher regex below is one a route refactor can silently disable. The real
 * gate is src/lib/auth/guard.ts, called by every layout and every route handler.
 *
 * It also deliberately avoids the DB because this runs on every matched request
 * including RSC prefetches, and a query per prefetch against a scale-to-zero
 * Neon instance is real latency for no benefit.
 */

const SESSION_COOKIE = 'sb_session'

/** Reachable without a session. Everything else bounces to /connect. */
const PUBLIC_PATHS = ['/connect']

/**
 * Where a signed-out `/` is served from.
 *
 * `/` has two pages: the app's Home for a signed-in user, the public landing
 * page for everyone else. Two route groups cannot both own `/` — Next refuses
 * routes in different groups that resolve to one path — and the (app) layout
 * that wraps Home calls requireUser(), so the landing page cannot live under
 * it. It lives at its own path instead, and a signed-out `/` is *rewritten* to
 * it: the browser's URL stays `/`, which is the link people share.
 *
 * Proxy runs once per request and not again on a rewrite target, so the
 * landing route does not need to be in PUBLIC_PATHS to render. Keeping it out
 * is deliberate: the set of pages a signed-out visitor can reach stays exactly
 * `/connect` plus this one rewrite, and the landing page reads no user data
 * either way.
 */
export const LANDING_PATH = '/welcome'

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const signedIn = request.cookies.has(SESSION_COOKIE)

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next()
  }

  if (pathname === '/' && !signedIn) {
    const url = request.nextUrl.clone()
    url.pathname = LANDING_PATH
    return NextResponse.rewrite(url)
  }

  // The landing page has one public URL, and it is `/`. Asked for by name it
  // redirects there — so a signed-in visitor lands on Home, and a signed-out
  // one gets the rewrite above — rather than becoming a second public path.
  if (pathname === LANDING_PATH || pathname.startsWith(`${LANDING_PATH}/`)) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    return NextResponse.redirect(url)
  }

  if (!signedIn) {
    const url = request.nextUrl.clone()
    url.pathname = '/connect'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /**
     * Pages only — ALL of /api is excluded, not just /api/auth.
     *
     * Redirecting an API request to an HTML page is worse than refusing it: a
     * client fetch() follows the 307, receives /connect with status 200, and
     * then res.json() throws somewhere far from the actual cause. Route
     * handlers call apiRequireUser/apiRequireReady themselves and answer with a
     * proper 401/409 JSON body, which is what a fetch caller can act on.
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
