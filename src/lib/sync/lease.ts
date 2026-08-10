import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm'
import { db } from '@/db'
import { syncState } from '@/db/schema'

/**
 * Sync concurrency control: a lease column, not a Postgres advisory lock.
 *
 * `pg_advisory_lock` is session-scoped, and even with the WebSocket pool giving
 * us real sessions, holding one across a sync would mean holding a Postgres
 * session open across many seconds of external HTTP I/O to Google. That is the
 * thing you must not do against a scale-to-zero instance with connection limits.
 * `pg_advisory_xact_lock` has the same problem, one level worse.
 *
 * A lease is a single UPDATE with a staleness predicate. It survives process
 * death via the timeout, works across tabs, deploys and regions, and needs no
 * connection held open. Two browser tabs polling at once is the common case and
 * it costs one round trip to resolve.
 */

/** Long enough to outlive a slow crawl, short enough that a killed run recovers fast. */
const LEASE_TTL_MS = 5 * 60 * 1000

export type Lease = { token: string }

export async function acquireLease(userId: string): Promise<Lease | null> {
  const token = randomUUID()
  const staleBefore = new Date(Date.now() - LEASE_TTL_MS)

  const rows = await db
    .update(syncState)
    .set({ lockToken: token, lockAcquiredAt: new Date() })
    .where(
      and(
        eq(syncState.userId, userId),
        or(isNull(syncState.lockAcquiredAt), lt(syncState.lockAcquiredAt, staleBefore)),
      ),
    )
    .returning({ userId: syncState.userId })

  return rows.length > 0 ? { token } : null
}

/**
 * Release, but only if we still hold it.
 *
 * The token check matters: if our run overran the TTL and another invocation
 * took over, releasing unconditionally would yank the lock out from under the
 * run that legitimately owns it now.
 */
export async function releaseLease(userId: string, lease: Lease): Promise<void> {
  await db
    .update(syncState)
    .set({ lockToken: null, lockAcquiredAt: null })
    .where(and(eq(syncState.userId, userId), eq(syncState.lockToken, lease.token)))
}

/** Extend the lease during a long crawl so a slow-but-alive run isn't stolen. */
export async function renewLease(userId: string, lease: Lease): Promise<boolean> {
  const rows = await db
    .update(syncState)
    .set({ lockAcquiredAt: new Date() })
    .where(and(eq(syncState.userId, userId), eq(syncState.lockToken, lease.token)))
    .returning({ userId: syncState.userId })

  return rows.length > 0
}

export async function bumpSyncSeq(userId: string): Promise<number> {
  const rows = await db
    .update(syncState)
    .set({ syncSeq: sql`${syncState.syncSeq} + 1` })
    .where(eq(syncState.userId, userId))
    .returning({ syncSeq: syncState.syncSeq })

  return rows[0]?.syncSeq ?? 0
}
