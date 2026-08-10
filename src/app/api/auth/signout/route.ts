import { NextResponse, type NextRequest } from 'next/server'
import {
  SESSION_COOKIE,
  getSession,
  revokeAllSessionsForUser,
  revokeSession,
} from '@/lib/auth/session'
import { env } from '@/lib/env'

/**
 * POST only — a GET sign-out is triggerable by any <img> tag on any page.
 *
 * The refresh token is deliberately left alone: signing out is not disconnecting
 * Drive. That is /api/auth/disconnect.
 */
export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value

  if (token) {
    if (request.nextUrl.searchParams.get('everywhere') === '1') {
      const session = await getSession()
      if (session) await revokeAllSessionsForUser(session.user.id)
    } else {
      await revokeSession(token)
    }
  }

  const response = NextResponse.redirect(new URL('/connect', env.APP_URL), { status: 303 })
  response.cookies.delete(SESSION_COOKIE)
  return response
}
