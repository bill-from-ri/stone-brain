/**
 * Read-only: list the live corpus with size + whether it already has claims.
 * Used by the seed-ground-truth skill to choose documents. No LLM, no writes.
 *
 *   npx tsx --conditions=react-server --tsconfig tsconfig.json scripts/list-corpus.ts
 */
import { config as loadEnv } from 'dotenv'

loadEnv({ path: ['.env.local', '.env'], quiet: true })

const { and, eq, isNull, sql } = await import('drizzle-orm')
const { db } = await import('@/db')
const { documents, users, claimSources } = await import('@/db/schema')

const [user] = await db.select({ id: users.id, email: users.email }).from(users).limit(2)
if (!user) throw new Error('No users in the database.')

const rows = await db
  .select({
    id: documents.id,
    name: documents.name,
    mimeType: documents.mimeType,
    sizeBytes: documents.sizeBytes,
    extractedDriveVersion: documents.extractedDriveVersion,
  })
  .from(documents)
  .where(and(eq(documents.userId, user.id), isNull(documents.removedAt)))

// Which documents already have claim_sources (i.e. have been extracted / seeded)?
const sourced = await db
  .select({ documentId: claimSources.documentId, n: sql<number>`count(*)::int` })
  .from(claimSources)
  .groupBy(claimSources.documentId)
const claimCount = new Map(sourced.map((s) => [s.documentId, s.n]))

console.log(`user: ${user.email}   documents: ${rows.length}\n`)
rows
  .sort((a, b) => (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0))
  .forEach((d) => {
    const kb = d.sizeBytes ? (d.sizeBytes / 1024).toFixed(0).padStart(5) : '    ?'
    const claims = claimCount.get(d.id)
    const tag = claims ? `  [${claims} sources]` : ''
    const doc = d.mimeType.includes('document') ? '' : `  (${d.mimeType})`
    console.log(`${kb} KB  ${d.name}${tag}${doc}`)
  })
