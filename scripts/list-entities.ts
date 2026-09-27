/**
 * Read-only: every existing entity, grouped by type, with its variants and how
 * many documents cite it.
 *
 * Seeding reuses an entity only when the new seed names it *identically* (after
 * `normalizeName`), so a labeller needs the live names — not the seed modules,
 * which miss anything entered by hand or by extraction. Run this before writing
 * a catalog and reuse these spellings exactly.
 *
 *   npx tsx --conditions=react-server --tsconfig tsconfig.json scripts/list-entities.ts [filter]
 *
 * `filter` is a case-insensitive substring matched against names and variants —
 * handy for checking a near-clash (`list-entities.ts enu` → Enua, Enuarak, …).
 */
import { config as loadEnv } from 'dotenv'

loadEnv({ path: ['.env.local', '.env'], quiet: true })

const { and, asc, countDistinct, eq, or } = await import('drizzle-orm')
const { db } = await import('@/db')
const { claimSources, claims, entities, users } = await import('@/db/schema')

const filter = process.argv.slice(2).join(' ').trim().toLowerCase()

const [user] = await db.select({ id: users.id }).from(users).limit(1)
if (!user) throw new Error('No users.')

// Documents citing any claim the entity is subject or object of.
const rows = await db
  .select({
    name: entities.name,
    type: entities.entityType,
    variants: entities.nameVariants,
    createdBy: entities.createdBy,
    documents: countDistinct(claimSources.documentId),
  })
  .from(entities)
  .leftJoin(
    claims,
    and(eq(claims.userId, entities.userId), or(eq(claims.subjectId, entities.id), eq(claims.objectId, entities.id))),
  )
  .leftJoin(claimSources, eq(claimSources.claimId, claims.id))
  .where(eq(entities.userId, user.id))
  .groupBy(entities.id)
  .orderBy(asc(entities.entityType), asc(entities.name))

const shown = filter
  ? rows.filter((r) => [r.name, ...(r.variants ?? [])].some((n) => n.toLowerCase().includes(filter)))
  : rows

let type = ''
for (const r of shown) {
  if (r.type !== type) {
    type = r.type
    console.log(`\n${type} (${shown.filter((s) => s.type === type).length})`)
  }
  const variants = r.variants?.length ? `  (aka ${r.variants.join(', ')})` : ''
  console.log(`  ${r.name}${variants}  — ${r.documents} doc(s), ${r.createdBy}`)
}
console.log(`\n${shown.length} of ${rows.length} entities`)
process.exit(0)
