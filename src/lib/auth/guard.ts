import 'server-only'
import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'
import { getSession, type SessionContext } from './session'

/**
 * The real authentication gate.
 *
 * src/proxy.ts also checks for a session cookie, but that is a UX fast path, not
 * a security boundary — its matcher is a regex that a route refactor can silently
 * stop covering, and Next's own docs say to verify inside each server function
 * rather than relying on proxy alone. Everything that reads user data calls one
 * of these.
 *
 * Two rules that are not negotiable:
 *   - No handler ever accepts a userId from the client. It comes from the session.
 *   - Every query in src/db/queries takes userId first and filters on it.
 */

export type SetupState = 'anonymous' | 'needs_root' | 'reconnect' | 'ready'

export function setupStateOf(session: SessionContext | null): SetupState {
  if (!session) return 'anonymous'
  if (session.tokenStatus !== 'active') return 'reconnect'
  if (!session.rootDriveFolderId) return 'needs_root'
  return 'ready'
}

export type AuthedUser = SessionContext
export type ReadyUser = SessionContext & { rootDriveFolderId: string }

/** For server components and layouts. Redirects rather than returning null. */
export async function requireUser(): Promise<AuthedUser> {
  const session = await getSession()
  if (!session) redirect('/connect')
  return session
}

/**
 * Additionally requires a chosen root folder.
 *
 * Deliberately tolerates tokenStatus !== 'active': the Postgres projection is
 * still valid and readable when a token dies, and only freshness is broken.
 * Hiding someone's Library because Google expired a token would be punishing
 * them for it. The reconnect banner handles that state instead (decisions §2).
 */
export async function requireReady(): Promise<ReadyUser> {
  const session = await requireUser()
  if (!session.rootDriveFolderId) redirect('/setup/folder')
  return session as ReadyUser
}

/* --------------------------------------------------------- route handlers */

/**
 * Route handlers cannot redirect usefully, so these return a 401/409 Response to
 * hand straight back. Written as an explicit two-value result so that forgetting
 * to check is a type error rather than a silent authorization bypass.
 */
export type ApiGuard<T> = { ok: true; session: T } | { ok: false; response: NextResponse }

export async function apiRequireUser(): Promise<ApiGuard<AuthedUser>> {
  const session = await getSession()
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'not_authenticated' }, { status: 401 }),
    }
  }
  return { ok: true, session }
}

export async function apiRequireReady(): Promise<ApiGuard<ReadyUser>> {
  const guard = await apiRequireUser()
  if (!guard.ok) return guard

  if (!guard.session.rootDriveFolderId) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'no_root_folder' }, { status: 409 }),
    }
  }
  return { ok: true, session: guard.session as ReadyUser }
}
