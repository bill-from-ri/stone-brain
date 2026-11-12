import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { LANDING_PATH, proxy } from './proxy'

/**
 * The proxy is a fast path, not the auth boundary (see the note at the top of
 * proxy.ts) — but it does decide what a signed-out visitor is shown, and the
 * landing-page rewrite added a branch that must not widen that. These pin the
 * whole table: one rewrite, one public page, everything else bounced.
 */

const ORIGIN = 'http://localhost:3000'

function request(path: string, { signedIn = false } = {}): NextRequest {
  const headers = signedIn ? { cookie: 'sb_session=opaque-token' } : undefined
  return new NextRequest(new URL(path, ORIGIN), { headers })
}

/** Where a rewrite is served from, or null for a response that is not one. */
function rewriteTarget(res: Response): string | null {
  const target = res.headers.get('x-middleware-rewrite')
  return target ? new URL(target).pathname : null
}

function redirectTarget(res: Response): string | null {
  const location = res.headers.get('location')
  return location ? new URL(location).pathname + new URL(location).search : null
}

/** `NextResponse.next()` — let the route render. */
function passesThrough(res: Response): boolean {
  return res.headers.get('x-middleware-next') === '1'
}

describe('signed out', () => {
  it('serves the landing page at / without changing the URL', () => {
    const res = proxy(request('/'))
    expect(rewriteTarget(res)).toBe(LANDING_PATH)
    expect(redirectTarget(res)).toBeNull()
  })

  it('keeps /connect reachable', () => {
    expect(passesThrough(proxy(request('/connect')))).toBe(true)
    expect(passesThrough(proxy(request('/connect?e=denied')))).toBe(true)
  })

  it.each(['/library', '/library/abc?doc=1', '/world', '/conflicts', '/settings', '/setup/folder'])(
    'still bounces %s to /connect',
    (path) => {
      const res = proxy(request(path))
      expect(redirectTarget(res)).toBe('/connect')
      expect(rewriteTarget(res)).toBeNull()
    },
  )

  it('serves the landing page for / with a query string too', () => {
    // `/?ref=…` is still `/` — a tracked portfolio link must not fall through
    // to the /connect bounce.
    expect(rewriteTarget(proxy(request('/?ref=portfolio')))).toBe(LANDING_PATH)
  })

  it('sends the landing route, asked for by name, to its one public URL', () => {
    expect(redirectTarget(proxy(request(LANDING_PATH)))).toBe('/')
    expect(redirectTarget(proxy(request(`${LANDING_PATH}/anything`)))).toBe('/')
  })
})

describe('signed in', () => {
  it('lets / render the app Home', () => {
    const res = proxy(request('/', { signedIn: true }))
    expect(passesThrough(res)).toBe(true)
    expect(rewriteTarget(res)).toBeNull()
  })

  it('lets app routes render', () => {
    expect(passesThrough(proxy(request('/library', { signedIn: true })))).toBe(true)
  })

  it('sends the landing route to /, which is Home for them', () => {
    expect(redirectTarget(proxy(request(LANDING_PATH, { signedIn: true })))).toBe('/')
  })
})
