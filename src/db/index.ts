import 'server-only'
import { Pool, neonConfig } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-serverless'
import ws from 'ws'
import { env } from '@/lib/env'
import * as schema from './schema'

/**
 * Neon over WebSocket, not HTTP.
 *
 * The HTTP driver is faster per query and is the obvious default for serverless,
 * but it throws on db.transaction() — it only supports non-interactive batches of
 * pre-built queries. Two things in this app need real interactive transactions:
 *
 *   - The OAuth callback: upsert user, then the account and session rows that
 *     reference the id it just produced.
 *   - The sync loop, where the invariant is that the Drive page token advances
 *     only inside the transaction that commits that page's writes. Without it,
 *     a crash between the writes and the token bump silently skips a page of
 *     changes. That invariant is the whole of "idempotent and resumable".
 *
 * poolQueryViaFetch routes non-transactional queries over HTTP anyway, so simple
 * reads keep the HTTP driver's latency and only transactions pay for the socket.
 */
neonConfig.webSocketConstructor = globalThis.WebSocket ?? ws
neonConfig.poolQueryViaFetch = true

// Reuse the pool across hot reloads in dev; a new pool per reload exhausts Neon's
// connection limit within a few edits.
const globalForDb = globalThis as unknown as { __sbPool?: Pool }

const pool = globalForDb.__sbPool ?? new Pool({ connectionString: env.DATABASE_URL })
if (!env.isProduction) globalForDb.__sbPool = pool

export const db = drizzle(pool, { schema })

export { schema }

/**
 * NOTE for the sync code: having a Pool means session-scoped pg_advisory_lock is
 * now technically available. Do not use it. Sync spans many seconds of external
 * HTTP I/O to Google, and holding a Postgres session or transaction open across
 * that is exactly the thing you must not do against a scale-to-zero instance.
 * Concurrency is a lease column on sync_state — see src/lib/sync/lease.ts.
 */
