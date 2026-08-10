import 'server-only'
import { OAuth2Client } from 'google-auth-library'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { googleAccounts } from '@/db/schema'
import { decrypt, encrypt, needsRewrap } from '@/lib/crypto/secretbox'
import { env } from '@/lib/env'
import { DriveAuthError, isInvalidGrant } from './errors'

/**
 * The single entry point for obtaining a usable Google access token.
 * Nothing else in the codebase reads google_accounts.
 */

/** Refresh this far before actual expiry, so a token can't die mid-request. */
const EXPIRY_SKEW_MS = 60_000

type CacheEntry = { token: string; expiresAt: number }

// Module scope: free inside a warm lambda, and nothing depends on it for
// correctness — a cold start simply falls through to the database.
const memo = new Map<string, CacheEntry>()

function fresh(expiresAt: number | null | undefined): boolean {
  return typeof expiresAt === 'number' && expiresAt - EXPIRY_SKEW_MS > Date.now()
}

export async function getAccessToken(userId: string): Promise<string> {
  const cached = memo.get(userId)
  if (cached && fresh(cached.expiresAt)) return cached.token

  const rows = await db
    .select({
      refreshTokenEnc: googleAccounts.refreshTokenEnc,
      accessTokenEnc: googleAccounts.accessTokenEnc,
      accessTokenExpiresAt: googleAccounts.accessTokenExpiresAt,
      tokenStatus: googleAccounts.tokenStatus,
    })
    .from(googleAccounts)
    .where(eq(googleAccounts.userId, userId))
    .limit(1)

  const account = rows[0]
  if (!account) throw new DriveAuthError('not_connected', 'No Google account is connected')
  if (account.tokenStatus === 'revoked') throw new DriveAuthError('revoked')
  if (!account.refreshTokenEnc) throw new DriveAuthError('not_connected', 'No refresh token on file')

  // Persisting the access token matters on Vercel: serverless instances recycle
  // constantly, and refreshing on every cold start burns Google's token endpoint
  // for no reason.
  const storedExpiry = account.accessTokenExpiresAt?.getTime()
  if (account.accessTokenEnc && fresh(storedExpiry)) {
    try {
      const token = decrypt(account.accessTokenEnc, userId, 'google_access_token')
      memo.set(userId, { token, expiresAt: storedExpiry! })
      return token
    } catch {
      // A key rotation gone wrong, or a corrupt row. Fall through and refresh.
    }
  }

  const refreshToken = decrypt(account.refreshTokenEnc, userId, 'google_refresh_token')

  const client = new OAuth2Client({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  })
  client.setCredentials({ refresh_token: refreshToken })

  let accessToken: string
  let expiryDate: number

  try {
    const { credentials } = await client.refreshAccessToken()
    if (!credentials.access_token) {
      throw new DriveAuthError('invalid_grant', 'Google returned no access token')
    }
    accessToken = credentials.access_token
    expiryDate = credentials.expiry_date ?? Date.now() + 3_600_000
  } catch (err) {
    if (isInvalidGrant(err)) {
      // The user revoked us, or the token expired through disuse. This is a
      // designed UI state, not an error path — see decisions §2 and the
      // ConnectionBanner. Record it so the Library can render the reconnect
      // affordance without having to ask Google again.
      await db
        .update(googleAccounts)
        .set({ tokenStatus: 'invalid_grant', tokenInvalidAt: new Date(), updatedAt: new Date() })
        .where(eq(googleAccounts.userId, userId))

      memo.delete(userId)
      throw new DriveAuthError('invalid_grant')
    }

    // Never let the raw error out: google-auth-library attaches the request body,
    // which contains the refresh token and client secret.
    throw new DriveAuthError(
      'invalid_grant',
      `Token refresh failed: ${err instanceof Error ? err.message : 'unknown error'}`,
    )
  }

  await db
    .update(googleAccounts)
    .set({
      accessTokenEnc: encrypt(accessToken, userId, 'google_access_token'),
      accessTokenExpiresAt: new Date(expiryDate),
      // Opportunistic rewrap during a write we were doing anyway: this is what
      // drains the population during a key rotation, with no migration script.
      ...(needsRewrap(account.refreshTokenEnc)
        ? { refreshTokenEnc: encrypt(refreshToken, userId, 'google_refresh_token') }
        : {}),
      tokenStatus: 'active',
      tokenInvalidAt: null,
      lastRefreshAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(googleAccounts.userId, userId))

  memo.set(userId, { token: accessToken, expiresAt: expiryDate })
  return accessToken
}

/** Drop a user's cached access token — call after disconnect or reconnect. */
export function forgetCachedToken(userId: string): void {
  memo.delete(userId)
}
