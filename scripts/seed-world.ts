/**
 * `npm run db:seed:world` — writes the hand-authored world data from
 * src/lib/ontology/seed-world.ts.
 *
 * Idempotent: entities match on normalized name, claims on their fingerprint.
 * Pass --dry to print what would be written without touching the database.
 */

import { config as loadEnv } from 'dotenv'
import { Pool, neonConfig } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-serverless'
import ws from 'ws'
import * as schema from '@/db/schema'
import { ordinalFor } from '@/lib/ontology/calendar'
import { SEED_CLAIMS, SEED_ENTITIES, seedWorld } from '@/lib/ontology/seed-world'

loadEnv({ path: ['.env.local', '.env'], quiet: true })

const dry = process.argv.includes('--dry')
const userId = process.argv.find((a) => a.startsWith('--user='))?.split('=')[1]

if (dry) {
  console.log(`${SEED_ENTITIES.length} entities, ${SEED_CLAIMS.length} claims\n`)

  const byType = new Map<string, string[]>()
  for (const e of SEED_ENTITIES) {
    if (!byType.has(e.type)) byType.set(e.type, [])
    byType.get(e.type)!.push(e.name + (e.variants ? ` (aka ${e.variants.join(', ')})` : ''))
  }
  for (const [type, names] of byType) console.log(`${type} (${names.length}): ${names.join(' · ')}`)

  const dated = SEED_CLAIMS.filter((c) => c.startTime || c.endTime || c.predicate === 'occurred_on')
  console.log(`\ndates:`)
  for (const c of dated) {
    const label = String(c.startTime ?? c.endTime ?? c.value)
    console.log(`  ${c.subject} ${c.predicate} "${label}" → ordinal ${ordinalFor(label) ?? 'null (unordered)'}`)
  }

  const inferred = SEED_CLAIMS.filter((c) => c.inferred)
  console.log(`\n${inferred.length} inferred claims:`)
  for (const c of inferred) console.log(`  ${c.subject} ${c.predicate} ${c.object ?? c.value} — ${c.inferred}`)
  process.exit(0)
}

if (!userId) throw new Error('pass --user=<uuid>, or --dry to preview')

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL_UNPOOLED (or DATABASE_URL) must be set')

neonConfig.webSocketConstructor = ws
const pool = new Pool({ connectionString: url })
try {
  const report = await seedWorld(drizzle(pool, { schema }), userId)
  console.log(
    `entities: ${report.entitiesCreated} created, ${report.entitiesExisting} already present\n` +
      `claims:   ${report.claimsCreated} created, ${report.claimsExisting} already present\n` +
      `document: ${report.documentId ?? 'NOT FOUND — claim sources have no document link'}`,
  )
} finally {
  await pool.end()
}
