import { and, eq, isNull, ne, sql, type SQL } from 'drizzle-orm'
import type { NeonDatabase } from 'drizzle-orm/neon-serverless'
import type * as schema from '@/db/schema'
import { claims } from '@/db/schema'
import { inverseOf, type InverseInput, type InverseVocabulary } from './inverse'

/**
 * Writing the inverse that `inverse.ts` describes, and the evidence with it.
 *
 * Takes a database handle rather than importing the app's, like
 * `extraction-write.ts`, so the seed loader, the backfill script and the
 * PGlite tests can all hand in their own — and so a caller already inside a
 * transaction passes that, and the inverse commits or rolls back with the
 * claim it mirrors.
 */

type Db = NeonDatabase<typeof schema>

/**
 * The columns the generated `fingerprint` is built from — the identity of a
 * claim as an assertion.
 */
export type Assertion = {
  subjectId: string
  predicate: string
  objectId?: string | null
  valueInt?: number | null
  valueFloat?: number | null
  valueString?: string | null
  valueTime?: string | null
  startTime?: string | null
  endTime?: string | null
}

/**
 * Find the claim making exactly this assertion, if one exists.
 *
 * Compared column by column, with an absent value meaning `IS NULL`, rather
 * than by computing a fingerprint string here: a computed copy would be a
 * second definition of the fingerprint, free to drift from the catalog's (see
 * `fingerprintMatches` in extraction-write.ts for the same reasoning). Every
 * column compared is one the fingerprint hashes, so a match here is a
 * fingerprint collision and nothing else.
 */
export async function findAssertion(
  db: Db,
  userId: string,
  assertion: Assertion,
  options: { excludeId?: string } = {},
): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: claims.id })
    .from(claims)
    .where(
      and(
        eq(claims.userId, userId),
        eq(claims.subjectId, assertion.subjectId),
        eq(claims.predicate, assertion.predicate),
        same(claims.objectId, assertion.objectId),
        same(claims.valueInt, assertion.valueInt),
        same(claims.valueFloat, assertion.valueFloat),
        same(claims.valueString, assertion.valueString),
        same(claims.valueTime, assertion.valueTime),
        same(claims.startTime, assertion.startTime),
        same(claims.endTime, assertion.endTime),
        options.excludeId ? ne(claims.id, options.excludeId) : undefined,
      ),
    )
    .limit(1)

  return row ?? null
}

function same<T>(column: Parameters<typeof eq>[0], value: T | null | undefined): SQL {
  return value === null || value === undefined ? isNull(column) : eq(column, value)
}

/**
 * Copy every citation of one claim onto another, skipping the ones it has.
 *
 * This is what keeps an inverse honest. A claim with no `claim_sources` row
 * reads as entered by hand, so an inverse written without its mirror's
 * evidence would show up as an unsourced assertion — and ADR §7a's
 * vanished-source flag would never reach it when the document goes.
 *
 * One `INSERT … SELECT`, so the copy is a single round trip however many
 * passages the claim cites. The `NOT EXISTS` is there for the same reason as
 * in `writeSources`: the unique index treats a null paragraph as distinct from
 * every other, so a citation with no anchor would otherwise be copied again on
 * every run.
 *
 * Returns the number of citations added.
 */
export async function copySources(
  db: Db,
  userId: string,
  fromClaimId: string,
  toClaimId: string,
): Promise<number> {
  const result = await db.execute(sql`
    insert into claim_sources
      (user_id, claim_id, document_id, document_name, quote, paragraph_index, document_revision_id)
    select s.user_id, ${toClaimId}::uuid, s.document_id, s.document_name, s.quote,
           s.paragraph_index, s.document_revision_id
    from claim_sources s
    where s.user_id = ${userId}::uuid
      and s.claim_id = ${fromClaimId}::uuid
      and not exists (
        select 1 from claim_sources t
        where t.claim_id = ${toClaimId}::uuid
          and t.document_id is not distinct from s.document_id
          and t.paragraph_index is not distinct from s.paragraph_index
      )
    on conflict do nothing
    returning id
  `)

  return result.rows.length
}

export type MaterialisedInverse = {
  id: string
  /** Whether this call created the inverse, rather than finding it present. */
  inserted: boolean
  sourcesCopied: number
}

/**
 * Write the inverse of an already-written claim, with its citations.
 *
 * Idempotent through the fingerprint index, with the same no-op DO UPDATE as
 * `upsertClaims`: an inverse that already exists — written earlier, or stated
 * outright by a document — comes back with its id and is left exactly as it
 * was, then gains any citations it was missing. Running this twice over the
 * same claim writes nothing the second time.
 *
 * Returns null for a claim with no reverse direction.
 */
export async function materialiseInverse(
  db: Db,
  claim: InverseInput & { id: string },
  vocabulary?: InverseVocabulary,
): Promise<MaterialisedInverse | null> {
  const inverse = inverseOf(claim, vocabulary)
  if (!inverse) return null

  const [row] = await db
    .insert(claims)
    .values(inverse)
    .onConflictDoUpdate({
      target: [claims.userId, claims.fingerprint],
      set: { subjectId: sql`excluded.subject_id` },
    })
    .returning({ id: claims.id, inserted: sql<boolean>`(xmax = 0)` })

  const sourcesCopied = await copySources(db, claim.userId, claim.id, row!.id)
  return { id: row!.id, inserted: row!.inserted, sourcesCopied }
}
