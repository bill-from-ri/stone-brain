/**
 * `npm run db:seed` — pushes src/lib/ontology/registry.ts into the three global
 * reference tables.
 *
 * Run after `db:migrate`, and again after any edit to the registry: the
 * vocabulary is curated in code, and this is how a change to it reaches a
 * database. Idempotent, so running it twice costs nothing.
 *
 * Opens its own connection rather than importing `@/db`, which is a
 * `server-only` singleton and throws outside Next.
 */

import { config as loadEnv } from 'dotenv'
import { Pool, neonConfig } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-serverless'
import ws from 'ws'
import * as schema from '@/db/schema'
import { seedOntology } from '@/lib/ontology/seed'

loadEnv({ path: ['.env.local', '.env'], quiet: true })

// The unpooled URL for the same reason drizzle-kit uses it: this is a real
// interactive transaction, not a batch.
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL_UNPOOLED (or DATABASE_URL) must be set')

neonConfig.webSocketConstructor = ws

const pool = new Pool({ connectionString: url })
try {
  const report = await seedOntology(drizzle(pool, { schema }))

  console.log(
    `seeded ${report.entityTypes} entity types, ` +
      `${report.predicates} predicates, ${report.signatures} signatures`,
  )
  if (report.pruned.length) {
    console.log(`\npruned ${report.pruned.length} row(s) no longer in the registry:`)
    for (const row of report.pruned) console.log(`  - ${row}`)
  }
  if (report.retained.length) {
    console.log(
      `\nKEPT ${report.retained.length} row(s) that the registry no longer declares, ` +
        `because claims still depend on them:`,
    )
    for (const row of report.retained) console.log(`  ! ${row}`)
    console.log('\nMigrate those claims before the vocabulary can drop them.')
  }
} finally {
  await pool.end()
}
