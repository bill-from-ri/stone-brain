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

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next()
  }

  if (!request.cookies.has(SESSION_COOKIE)) {
    const url = request.nextUrl.clone()
    url.pathname = '/connect'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    // Everything except the auth API (which must be reachable while signed out),
    // Next internals, and static assets.
    '/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
