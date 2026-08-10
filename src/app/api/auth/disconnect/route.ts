import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { googleAccounts } from '@/db/schema'
import { getSession } from '@/lib/auth/session'
import { decrypt } from '@/lib/crypto/secretbox'
import { env } from '@/lib/env'

/**
 * Revoke the Drive grant at Google and forget our copy of it.
 *
 * The projection — folders, documents, sync_state — is deliberately KEPT. It is
 * ours, not Drive's (decisions §3), and reconnecting should be instant rather
 * than a re-crawl. Deleting the index is a separate, explicitly destructive action.
 */
export async function POST() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401 })
  }

  const rows = await db
    .select({ refreshTokenEnc: googleAccounts.refreshTokenEnc })
    .from(googleAccounts)
    .where(eq(googleAccounts.userId, session.user.id))
    .limit(1)

  const enc = rows[0]?.refreshTokenEnc
  if (enc) {
    try {
      const refreshToken = decrypt(enc, session.user.id, 'google_refresh_token')
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: refreshToken }),
      })
    } catch (err) {
      // A revoke that fails at Google must not block us forgetting the token —
      // the user asked to disconnect and we still can, locally.
      console.warn('[auth] Google revoke failed:', err instanceof Error ? err.message : 'unknown')
    }
  }

  await db
    .update(googleAccounts)
    .set({
      refreshTokenEnc: null,
      accessTokenEnc: null,
      accessTokenExpiresAt: null,
      tokenStatus: 'revoked',
      tokenInvalidAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(googleAccounts.userId, session.user.id))

  return NextResponse.redirect(new URL('/connect?e=disconnected', env.APP_URL), { status: 303 })
}
