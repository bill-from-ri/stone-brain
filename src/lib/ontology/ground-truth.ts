import { and, eq, sql } from 'drizzle-orm'
import type { NeonDatabase } from 'drizzle-orm/neon-serverless'
import type * as schema from '@/db/schema'
import { claimSources, claims, documents, entities } from '@/db/schema'
import { ordinalFor } from './calendar'
import { materialiseInverse } from './inverse-write'
import { normalizeName } from './matcher'
import { deriveOntology } from './registry'

/**
 * The shape of hand-seeded ground truth, and the loader that writes it.
 *
 * The seed *data* — the entities and claims read from real documents, with
 * their quotes — is not in the repository. It lives in `corpus/seeds/`, which
 * is gitignored: the documents are private worldbuilding, and the quotes are
 * verbatim. This module is what every seed module imports.
 *
 * These claims are **ground truth for scoring Phase 2B extraction**, which is
 * the whole reason they are written by hand. Generate them with a model and
 * the scoring compares a model to itself and always passes.
 *
 * Everything here is `created_by: 'seed'` and `canonicity: 'canon'` — read from
 * a real document by a human, unlike an extractor's output, which lands as
 * `draft`. Re-running is safe: entities match on `(user, type, normalized
 * name)` and claims on the generated `fingerprint`.
 *
 * Only the direction the document states is labelled here. The loader writes
 * each relationship's inverse too, cited by the same passage, so the seeded
 * graph obeys the same invariant as everything else (see `inverse.ts`) and
 * scoring can compare it against extraction output that does the same.
 */

type Db = NeonDatabase<typeof schema>

export type SeedEntity = {
  name: string
  type: string
  variants?: string[]
  summary?: string
}

type SeedClaimBase = {
  subject: string
  predicate: string
  /** Relationship claims. */
  object?: string
  /** Attribute claims — routed by the predicate's declared value type. */
  value?: string | number
  startTime?: string
  endTime?: string
}

/** A claim read from the seed's document, cited by quote and paragraph. */
export type SourcedSeedClaim = SeedClaimBase & {
  quote: string
  paragraph: number
  /** Why this is a reading rather than a quote. Recorded, not enforced. */
  inferred?: string
  handEntered?: undefined
}

/**
 * A claim a person asserted with no document behind it — typically a
 * cross-document link no single document states (Enuarak lies in Enua).
 * Written as `created_by: 'user'` with no `claim_sources` row, so it is part of
 * the world but never part of any document's ground truth.
 */
export type HandEnteredSeedClaim = SeedClaimBase & {
  /** Why it was entered by hand. Recorded, not stored. */
  handEntered: string
  quote?: undefined
  paragraph?: undefined
  inferred?: undefined
}

export type SeedClaim = SourcedSeedClaim | HandEnteredSeedClaim

/* ---------------------------------------------------------------- the loader */

export type WorldSeedReport = {
  entitiesCreated: number
  entitiesExisting: number
  /** Existing entities that had no summary and were given the seed's. */
  summariesFilled: number
  /** Claims as labelled — the reverse directions are counted below. */
  claimsCreated: number
  claimsExisting: number
  /** Inverses written this run that were not already in the graph. */
  inversesCreated: number
  /**
   * Citations written this run. Normally equals `claimsCreated`; it runs higher
   * when a claim already existed from another document and this one is added as
   * a second source for it.
   */
  sourcesCreated: number
  documentId: string | null
}

/**
 * The reusable loader behind every hand-seeded document.
 *
 * Every seed module is the same insert logic over different data, so it lives
 * here once: entities match on
 * `(user, type, normalized name)` and are reused across documents — which is
 * how "Elduin" and "Grain", first seeded from Written Map, are found rather than
 * duplicated when a second document names them. Claims match on the generated
 * `fingerprint`. Re-running any seed is a no-op.
 *
 * A fact stated in two documents is one claim with two `claim_sources` rows: if
 * a claim already exists — seeded from an earlier document — this document is
 * still recorded as a source for it, so its ground truth is complete.
 */
export async function loadSeed(
  db: Db,
  userId: string,
  source: { name: string; driveFileId: string },
  seedEntities: SeedEntity[],
  seedClaims: SeedClaim[],
): Promise<WorldSeedReport> {
  const [doc] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.userId, userId), eq(documents.driveFileId, source.driveFileId)))
    .limit(1)

  const documentId = doc?.id ?? null

  // A hand-seeded document is ground truth a person read and labelled, so it is
  // Verified by definition — the one place `verified` is set from code rather
  // than by a user click, and legitimately so (contrast the extraction path,
  // which may only ever reach `extracted`). Idempotent; skipped when the
  // document has not synced yet.
  if (documentId !== null) {
    await db.update(documents).set({ status: 'verified' }).where(eq(documents.id, documentId))
  }

  const report: WorldSeedReport = {
    entitiesCreated: 0,
    entitiesExisting: 0,
    summariesFilled: 0,
    claimsCreated: 0,
    claimsExisting: 0,
    inversesCreated: 0,
    sourcesCreated: 0,
    documentId,
  }

  const idByName = new Map<string, { id: string; type: string }>()

  for (const entity of seedEntities) {
    const normalized = normalizeName(entity.name)

    const [existing] = await db
      .select({ id: entities.id, summary: entities.summary })
      .from(entities)
      .where(
        and(
          eq(entities.userId, userId),
          eq(entities.entityType, entity.type),
          eq(entities.normalizedName, normalized),
        ),
      )
      .limit(1)

    if (existing) {
      idByName.set(entity.name, { id: existing.id, type: entity.type })
      report.entitiesExisting++
      // Fill a missing summary, never replace one: a summary already there may
      // have been written or edited by hand, and the seed is not its owner.
      if (entity.summary !== undefined && existing.summary === null) {
        await db.update(entities).set({ summary: entity.summary }).where(eq(entities.id, existing.id))
        report.summariesFilled++
      }
      continue
    }

    const [created] = await db
      .insert(entities)
      .values({
        userId,
        entityType: entity.type,
        name: entity.name,
        normalizedName: normalized,
        nameVariants: entity.variants ?? [],
        canonicity: 'canon',
        createdBy: 'seed',
        ...(entity.summary !== undefined && { summary: entity.summary }),
        ...(documentId !== null && { sourceDocumentId: documentId }),
      })
      .returning({ id: entities.id })

    idByName.set(entity.name, { id: created!.id, type: entity.type })
    report.entitiesCreated++
  }

  for (const claim of seedClaims) {
    const subject = idByName.get(claim.subject)
    if (!subject) throw new Error(`Seed claim names an entity not in the entity list: ${claim.subject}`)

    const object = claim.object ? idByName.get(claim.object) : undefined
    if (claim.object && !object) {
      throw new Error(`Seed claim names an object not in the entity list: ${claim.object}`)
    }

    const values = {
      userId,
      subjectId: subject.id,
      subjectType: subject.type,
      predicate: claim.predicate,
      objectId: object?.id ?? null,
      objectType: object?.type ?? null,
      ...valueColumns(claim),
      ...(claim.startTime !== undefined && {
        startTime: claim.startTime,
        ...withOrder('startOrder', claim.startTime),
      }),
      ...(claim.endTime !== undefined && {
        endTime: claim.endTime,
        ...withOrder('endOrder', claim.endTime),
      }),
      canonicity: 'canon' as const,
      createdBy: claim.handEntered === undefined ? ('seed' as const) : ('user' as const),
    }

    const [written] = await db
      .insert(claims)
      .values(values)
      // The fingerprint index is what makes re-running this a no-op rather than
      // a duplicate. The conflict action is a DO UPDATE that changes nothing, as
      // in `extraction-write.ts`, because DO NOTHING returns no id — and an
      // existing claim still needs this document's citation.
      .onConflictDoUpdate({
        target: [claims.userId, claims.fingerprint],
        set: { subjectId: sql`excluded.subject_id` },
      })
      .returning({ id: claims.id, inserted: sql<boolean>`(xmax = 0)` })

    if (written!.inserted) report.claimsCreated++
    else report.claimsExisting++

    if (claim.handEntered === undefined) {
      const [cited] = await db
        .insert(claimSources)
        .values({
          userId,
          claimId: written!.id,
          documentId,
          documentName: source.name,
          quote: claim.quote,
          paragraphIndex: claim.paragraph,
        })
        .onConflictDoNothing()
        .returning({ id: claimSources.id })

      if (cited) report.sourcesCreated++
    }

    // After the citation, so the inverse is cited by it too. A hand-entered
    // claim has none to copy, and its inverse is hand-entered alike.
    const inverse = await materialiseInverse(db, { ...values, id: written!.id })
    if (inverse?.inserted) report.inversesCreated++
  }

  return report
}

const VALUE_TYPES = new Map(deriveOntology().predicates.map((p) => [p.name, p.valueType]))

/**
 * Routes a seed value into the column its predicate declares — asking the
 * registry rather than guessing from the value's JavaScript type, so a date
 * cannot silently land in `value_string` and fail the signature foreign key.
 */
function valueColumns(claim: SeedClaim): Record<string, unknown> {
  if (claim.value === undefined) return {}

  const valueType = VALUE_TYPES.get(claim.predicate)
  if (!valueType) throw new Error(`Seed claim uses '${claim.predicate}', which is not an attribute`)

  switch (valueType) {
    case 'int':
      return { valueInt: Number(claim.value) }
    case 'float':
      return { valueFloat: Number(claim.value) }
    case 'date':
      return { valueTime: String(claim.value), ...withOrder('valueOrder', String(claim.value)) }
    default:
      return { valueString: String(claim.value) }
  }
}

/** An unreadable label keeps its text and loses only its ordering. */
function withOrder(column: 'startOrder' | 'endOrder' | 'valueOrder', label: string) {
  const order = ordinalFor(label)
  return order === null ? {} : { [column]: order }
}
