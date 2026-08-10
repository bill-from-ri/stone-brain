import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { cache } from 'react'
import { db } from '@/db'
import { googleAccounts, sessions, syncState, users } from '@/db/schema'
import type { TokenStatus } from '@/db/schema'
import { env } from '@/lib/env'

export const SESSION_COOKIE = 'sb_session'
const SESSION_TTL_DAYS = 30
const SESSION_TTL_SECONDS = SESSION_TTL_DAYS * 24 * 60 * 60

/**
 * Only the hash of the cookie value is ever stored, so a database dump yields
 * no live sessions.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: env.isProduction,
  sameSite: 'lax',
  path: '/',
  maxAge: SESSION_TTL_SECONDS,
} as const

export async function issueSession(userId: string, userAgent?: string | null): Promise<string> {
  const token = randomBytes(32).toString('base64url')

  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
    userAgent: userAgent ?? null,
  })

  return token
}

export async function revokeSession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)))
}

export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId))
}

export type SessionContext = {
  sessionId: string
  user: {
    id: string
    email: string
    name: string | null
    pictureUrl: string | null
  }
  /** Null when the account row is somehow missing — treated as not connected. */
  tokenStatus: TokenStatus | null
  rootDriveFolderId: string | null
  rootFolderName: string | null
}

/**
 * Resolve the current session, or null.
 *
 * Wrapped in React's cache() so a layout, a page, and three server components
 * calling this during one render pass produce a single query.
 */
export const getSession = cache(async (): Promise<SessionContext | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) return null

  const rows = await db
    .select({
      sessionId: sessions.id,
      userId: users.id,
      email: users.email,
      name: users.name,
      pictureUrl: users.pictureUrl,
      tokenStatus: googleAccounts.tokenStatus,
      rootDriveFolderId: syncState.rootDriveFolderId,
      rootFolderName: syncState.rootFolderName,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(googleAccounts, eq(googleAccounts.userId, users.id))
    .leftJoin(syncState, eq(syncState.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1)

  const row = rows[0]
  if (!row) return null

  return {
    sessionId: row.sessionId,
    user: {
      id: row.userId,
      email: row.email,
      name: row.name,
      pictureUrl: row.pictureUrl,
    },
    tokenStatus: row.tokenStatus,
    rootDriveFolderId: row.rootDriveFolderId,
    rootFolderName: row.rootFolderName,
  }
})
