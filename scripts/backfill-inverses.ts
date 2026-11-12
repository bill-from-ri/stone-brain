/**
 * `npm run db:backfill:inverses` — gives every relationship claim already in
 * the database its reverse direction.
 *
 * Every write path now materialises the inverse of a relationship as it writes
 * it (src/lib/ontology/inverse.ts). Rows written before that — extracted,
 * seeded, or entered by hand with the old "also record the reverse" box
 * unticked — have only the direction they were written in. This mends them
 * with the same function the write paths use, so the backfilled inverse is
 * exactly what a fresh write would have produced: ends swapped, the same dates
 * and provenance, and the same citations copied across.
 *
 * Idempotent: an inverse already present is found through the fingerprint and
 * left as it is, gaining only the citations it lacked. A second run writes
 * nothing. All of it runs in one transaction, so an interrupted run leaves the
 * database as it found it. Pass --dry to count without writing.
 */

import { config as loadEnv } from 'dotenv'
import { Pool, neonConfig } from '@neondatabase/serverless'
import { isNotNull } from 'drizzle-orm'
import { drizzle, type NeonDatabase } from 'drizzle-orm/neon-serverless'
import ws from 'ws'
import * as schema from '@/db/schema'
import type { InverseVocabulary } from '@/lib/ontology/inverse'
import { materialiseInverse } from '@/lib/ontology/inverse-write'

loadEnv({ path: ['.env.local', '.env'], quiet: true })

const dry = process.argv.includes('--dry')

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL_UNPOOLED (or DATABASE_URL) must be set')

/** Thrown to roll a --dry run back once it has counted what it would write. */
class DryRun extends Error {}

type Counts = {
  scanned: number
  created: number
  present: number
  sourcesCopied: number
  /** Relationships whose predicate declares no inverse. None, today. */
  noInverse: number
}

neonConfig.webSocketConstructor = ws
const pool = new Pool({ connectionString: url })
const db = drizzle(pool, { schema })

const counts: Counts = { scanned: 0, created: 0, present: 0, sourcesCopied: 0, noInverse: 0 }

try {
  await db.transaction(async (raw) => {
    const tx = raw as unknown as NeonDatabase<typeof schema>

    // The database's own vocabulary, not the registry's: these are rows that
    // table already governs, and the signature foreign key will check the
    // inverse against it.
    const predicates = await tx
      .select({
        name: schema.predicates.name,
        kind: schema.predicates.kind,
        inverseName: schema.predicates.inverseName,
      })
      .from(schema.predicates)
    const vocabulary: InverseVocabulary = new Map(predicates.map((p) => [p.name, p]))

    // Read once, up front: the inverses written below are not themselves
    // revisited, and need not be — the inverse of each is the claim it came from.
    const relationships = await tx
      .select()
      .from(schema.claims)
      .where(isNotNull(schema.claims.objectId))

    for (const claim of relationships) {
      counts.scanned++
      const inverse = await materialiseInverse(tx, claim, vocabulary)
      if (!inverse) {
        counts.noInverse++
        continue
      }
      if (inverse.inserted) counts.created++
      else counts.present++
      counts.sourcesCopied += inverse.sourcesCopied
    }

    if (dry) throw new DryRun()
  })
} catch (error) {
  if (!(error instanceof DryRun)) throw error
} finally {
  await pool.end()
}

console.log(
  `${dry ? 'DRY RUN — nothing written\n' : ''}` +
    `relationship claims: ${counts.scanned} scanned\n` +
    `inverses:            ${counts.created} created, ${counts.present} already present\n` +
    `citations:           ${counts.sourcesCopied} copied onto an inverse\n` +
    `no inverse declared: ${counts.noInverse}`,
)
