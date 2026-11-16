import { and, eq, inArray, sql } from 'drizzle-orm'
import type { NeonDatabase } from 'drizzle-orm/neon-serverless'
import type * as schema from '@/db/schema'
import { claimSources, claims, documents, entities, type RetractionOutcome } from '@/db/schema'
import { ordinalFor } from './calendar'
import { createDraftEntities, type CreatedDraft, type DraftProposal } from './entity-drafts'
import type { ExistingClaim } from './existing-claims'
import type { ExtractedClaim, Retraction } from './extraction'
import { inverseOf } from './inverse'
import { buildEntityIndex, resolve, type EntityIndex } from './matcher'
import { looseNameKey, normalizeName } from './name-key'

/**
 * The join between what a model produced and what the tables hold.
 *
 * `parseExtraction()` has already guaranteed the shape: every claim here names
 * a real predicate, with types the ontology permits. What it cannot do is turn
 * a *name* into a UUID, and that is this module's job — plus the two things
 * that make a run repeatable rather than accumulative.
 *
 * ## Idempotency
 *
 * Writing claims is **additive**: new claims are inserted, ones already
 * present are no-ops. The mechanism is `claims.fingerprint`, a generated
 * column, with its unique index as the conflict target. Two runs over an
 * unchanged document therefore write the same rows and produce the same graph.
 *
 * ## Retraction
 *
 * A re-extraction is shown the claims the document already holds (see
 * `existing-claims.ts`) and may retract one by name, with a reason — the only
 * way extraction removes anything. Never by omission: a claim the model did not
 * mention is kept, so a model having an off day cannot silently retract real
 * claims. Non-determinism must not become data loss. What a retraction may do
 * is narrow, too — see `applyRevision`.
 *
 * ## Inverses
 *
 * Every relationship claim is written with its reverse direction (see
 * `inverse.ts`), in the same statement, rather than asking the model for both —
 * which would cost output tokens and still leave the two directions free to
 * disagree. The inverse goes through the same fingerprint upsert, so a document
 * that states both directions, or a second run over it, does not double up;
 * and it carries the same citations as the claim it mirrors, so it is never
 * mistaken for an unsourced one.
 *
 * ## What is refused
 *
 * Unresolvable *names* are created as drafts (see `entity-drafts.ts`), so an
 * extraction on a fresh library still lands. But two cases are refused rather
 * than guessed at, and both come back as `unwritten` for §6 to surface:
 *
 *   - **Ambiguity.** A name matching two entities is not resolved by picking
 *     one. `entities.normalized_name` is deliberately not unique, so the
 *     collision is real information.
 *   - **Type disagreement.** The model called something a `place` that the
 *     graph holds as a `faction`. Writing it under either type asserts
 *     something nobody checked, and the extraction contract already names this
 *     "a useful signal" — so it is reported, not reconciled.
 */

export type ExtractionContext = {
  documentId: string
  /** Snapshotted onto every source row, so a citation survives the document (§7a). */
  documentName: string
  /** From `revisions.list` at read time. Provenance, not staleness (ADR §6). */
  headRevisionId: string | null
  /** `files.version` at read time — the staleness signal (ADR §6). */
  driveVersion: number | null
  /** The model that produced these claims (ADR §11). */
  model: string
}

export type UnwrittenClaim = {
  /** Index into the claims array handed in, so a caller can name the offender. */
  index: number
  code: 'entity_ambiguous' | 'entity_type_mismatch' | 'entity_unresolved'
  message: string
  claim: ExtractedClaim
}

/**
 * The re-extraction half of a write: what the document held before this run,
 * and which of it the model retracted. Absent on a first extraction.
 */
export type Revision = {
  existing: ExistingClaim[]
  retractions: Retraction[]
}

/** The claim a retraction was about, as it read before — the audit snapshot. */
export type RetractedClaim = {
  subject: string
  subjectType: string
  predicate: string
  object: string | null
  objectType: string | null
  value: string | null
  startTime: string | null
  endTime: string | null
  quotes: { paragraphIndex: number | null; quote: string | null }[]
}

export type AppliedRetraction = {
  handle: string
  /** The claim shown to the model; its inverse, if any, went the same way. */
  claimId: string
  outcome: RetractionOutcome
  reason: string
  /** Why a `held` retraction was not applied. */
  detail: string | null
  claim: RetractedClaim
}

export type WriteExtractionResult = {
  /**
   * Claims the model stated that this run created. Inverses are counted
   * separately below, so this stays a measure of what was read from the
   * document — doubling it for the reverse directions would make every
   * extraction look twice as productive as it was.
   */
  claimsCreated: number
  /** Claims the run re-asserted that were already in the graph. */
  claimsAlreadyPresent: number
  /**
   * Reverse directions this run created that the model did not itself state.
   * An inverse the document also stated outright counts once, as a claim.
   */
  inversesCreated: number
  /**
   * `claim_sources` rows added for the claims as stated — a new citation for a
   * claim, new or not. The same citation mirrored onto an inverse is not
   * counted again, for the same reason as `claimsCreated`.
   */
  sourcesCreated: number
  entitiesCreated: CreatedDraft[]
  unwritten: UnwrittenClaim[]
  /** Every retraction the model made, applied or held. Empty without a revision. */
  retractions: AppliedRetraction[]
  /** Retractions that changed something: a claim deleted or a citation withdrawn. */
  claimsRetracted: number
  /** Kept citations re-pointed at the paragraph their quote moved to. */
  sourcesRelocated: number
}

type ClaimsWritten = Omit<WriteExtractionResult, 'retractions' | 'claimsRetracted' | 'sourcesRelocated'> & {
  /** Every claim id this run asserted or mirrored — never retracted by the same run. */
  assertedIds: Set<string>
}

/** `entityType|normalizedName` — how a claim's ends are keyed while resolving. */
const refKey = (name: string, entityType: string) => `${entityType}|${normalizeName(name)}`

type Resolution =
  | { status: 'id'; id: string }
  | { status: 'ambiguous'; message: string }
  | { status: 'type_mismatch'; message: string }

/**
 * Write one document's extraction.
 *
 * Runs inside a single transaction: a half-written extraction — claims without
 * their sources, or a document stamped as extracted when it was not — is worse
 * than none, because nothing downstream could tell it apart from a real one.
 */
export async function writeExtraction(
  db: NeonDatabase<typeof schema>,
  userId: string,
  extracted: ExtractedClaim[],
  context: ExtractionContext,
  revision?: Revision,
): Promise<WriteExtractionResult> {
  return db.transaction(async (raw) => {
    // Drizzle types a transaction as its own handle rather than as the database
    // it came from. Every query below is ordinary query-builder syntax that
    // both support, so the cast buys uniform helpers without widening anything.
    const tx = raw as unknown as NeonDatabase<typeof schema>

    // Claims first, so a retraction can see what this same run re-asserted.
    const { assertedIds, ...written } = await writeClaims(tx, userId, extracted, context)
    const revised = revision
      ? await applyRevision(tx, userId, context, revision, assertedIds)
      : { retractions: [], claimsRetracted: 0, sourcesRelocated: 0 }
    await stampDocument(tx, userId, context)

    return { ...written, ...revised }
  })
}

async function writeClaims(
  db: NeonDatabase<typeof schema>,
  userId: string,
  extracted: ExtractedClaim[],
  context: ExtractionContext,
): Promise<ClaimsWritten> {
  if (extracted.length === 0) {
    return {
      claimsCreated: 0,
      claimsAlreadyPresent: 0,
      inversesCreated: 0,
      sourcesCreated: 0,
      entitiesCreated: [],
      unwritten: [],
      assertedIds: new Set(),
    }
  }

  const index = await loadIndex(db, userId)
  const { resolutions, creates } = resolveEnds(index, extracted)

  // The one place entities are created, and only for names that resolved to
  // nothing at all — never for an ambiguity or a type disagreement, which are
  // failures to understand rather than gaps in the graph.
  const entitiesCreated = await createDraftEntities(
    db,
    userId,
    creates.map((c) => c.proposal),
    { documentId: context.documentId, model: context.model },
  )

  const createdByKey = new Map(
    entitiesCreated.map((draft) => [refKey(draft.name, draft.entityType), draft.id]),
  )
  for (const { proposal, refKeys } of creates) {
    const id = createdByKey.get(refKey(proposal.name, proposal.entityType))
    if (!id) continue
    // Every spelling that collapsed into this proposal points at the one row.
    for (const key of refKeys) resolutions.set(key, { status: 'id', id })
  }

  const unwritten: UnwrittenClaim[] = []
  const pending: { claim: ExtractedClaim; row: ClaimRow }[] = []

  for (const [i, claim] of extracted.entries()) {
    const subject = resolutions.get(refKey(claim.subjectName, claim.subjectType))
    const object = claim.objectName
      ? resolutions.get(refKey(claim.objectName, claim.objectType ?? ''))
      : null

    const ends = claimEnds(i, claim, subject, object)
    if (!ends.ok) {
      unwritten.push(ends.unwritten)
      continue
    }

    pending.push({
      claim,
      row: buildClaimRow(userId, claim, ends.subjectId, ends.objectId, context),
    })
  }

  if (pending.length === 0) {
    return {
      claimsCreated: 0,
      claimsAlreadyPresent: 0,
      inversesCreated: 0,
      sourcesCreated: 0,
      entitiesCreated,
      unwritten,
      assertedIds: new Set(),
    }
  }

  /*
   * Inverses ride in the same batch, after the stated claims. Order matters
   * only for the in-batch dedupe in `upsertClaims`, which keeps the first row
   * of an identity: a direction the model stated outright is then written as
   * stated, and the inverse that happens to equal it folds into it. Each
   * inverse is paired with the claim it mirrors, so it is cited by that
   * claim's quote.
   */
  const inverses = pending.flatMap(({ claim, row }) => {
    const inverse = inverseOf({ ...row, objectId: row.objectId, objectType: row.objectType })
    return inverse ? [{ claim, row: inverse, mirror: true }] : []
  })

  const written = await upsertClaims(db, [
    ...pending.map((p) => ({ ...p, mirror: false })),
    ...inverses,
  ])
  const stated = written.filter((w) => !w.mirror)
  const mirrored = written.filter((w) => w.mirror)

  const sourcesCreated = await writeSources(db, userId, stated, context)
  await writeSources(db, userId, mirrored, context)

  const statedIds = new Set(stated.map((w) => w.id))

  return {
    claimsCreated: countClaims(stated, true),
    claimsAlreadyPresent: countClaims(stated, false),
    inversesCreated: countClaims(
      mirrored.filter((w) => !statedIds.has(w.id)),
      true,
    ),
    sourcesCreated,
    entitiesCreated,
    unwritten,
    assertedIds: new Set(written.map((w) => w.id)),
  }
}

/* -------------------------------------------------------------- revision */

/**
 * Apply a re-extraction's retractions, then re-point the citations that are
 * left at the paragraphs their quotes now sit in.
 *
 * ## What a retraction may do
 *
 * A retraction is about **this document**: it says this document no longer
 * supports the claim, not that the claim is false. So:
 *
 *   - It removes this document's citations of the claim and its inverse.
 *   - The claim itself is deleted only when no citation is left — another
 *     document that still says it keeps it standing (`citation_removed`). If
 *     the two documents now disagree, that is a Phase 3 conflict, which is the
 *     honest outcome: one changed its mind and the other did not.
 *   - Canon, and anything a person or the seed wrote, is never touched (`held`).
 *     The model may think it no longer holds; a person decides.
 *   - A claim this same run asserted is never retracted (`held`): the model
 *     retracted a claim and re-emitted it identically, and keeping is the side
 *     to err on.
 *
 * A fact is held or retracted as a whole — both directions together — so the
 * graph never keeps one end of a relationship it dropped the other end of.
 *
 * Every retraction is returned, held ones included, for the run to record.
 */
async function applyRevision(
  db: NeonDatabase<typeof schema>,
  userId: string,
  context: ExtractionContext,
  revision: Revision,
  assertedIds: Set<string>,
): Promise<Pick<WriteExtractionResult, 'retractions' | 'claimsRetracted' | 'sourcesRelocated'>> {
  const byHandle = new Map(revision.existing.map((c) => [c.handle, c]))
  const applied: AppliedRetraction[] = []
  const gone = new Set<string>()

  for (const { handle, reason } of revision.retractions) {
    const fact = byHandle.get(handle)
    if (!fact) continue
    const primary = fact.members[0]!
    const ids = fact.members.map((m) => m.id)

    const record = (outcome: RetractionOutcome, detail: string | null) =>
      applied.push({ handle, claimId: primary.id, outcome, reason, detail, claim: snapshot(fact) })

    if (ids.some((id) => assertedIds.has(id))) {
      record('held', 'This run also re-asserted the claim, so it was kept.')
      continue
    }
    const guarded = fact.members.find((m) => m.canonicity === 'canon' || m.createdBy !== 'llm')
    if (guarded) {
      record(
        'held',
        guarded.canonicity === 'canon'
          ? 'The claim is canon; a person decides whether it still holds.'
          : 'The claim was not written by extraction; a person decides whether it still holds.',
      )
      continue
    }

    await db
      .delete(claimSources)
      .where(
        and(
          eq(claimSources.userId, userId),
          eq(claimSources.documentId, context.documentId),
          inArray(claimSources.claimId, ids),
        ),
      )

    const deleted = await db
      .delete(claims)
      .where(
        and(
          eq(claims.userId, userId),
          inArray(claims.id, ids),
          sql`not exists (select 1 from ${claimSources} where ${claimSources.claimId} = ${claims.id})`,
        ),
      )
      .returning({ id: claims.id })

    for (const id of ids) gone.add(id)
    record(deleted.some((d) => d.id === primary.id) ? 'deleted' : 'citation_removed', null)
  }

  const sourcesRelocated = await relocateSources(db, userId, context, revision.existing, gone)

  return {
    retractions: applied,
    claimsRetracted: applied.filter((a) => a.outcome !== 'held').length,
    sourcesRelocated,
  }
}

/**
 * Move each surviving citation whose quote has moved to the paragraph it is in
 * now, so the paragraph numbers a person clicks — and the next run is shown —
 * are true. A quote no longer found anywhere is left where it was: the model
 * was told it was missing and chose to keep the claim.
 *
 * Done as delete-then-reinsert rather than in-place updates, because two moves
 * can swap paragraphs and the `(claim, document, paragraph)` index is checked
 * per statement. A moved citation that lands on one the claim already has is
 * the same citation twice, and the reinsert drops it.
 */
async function relocateSources(
  db: NeonDatabase<typeof schema>,
  userId: string,
  context: ExtractionContext,
  existing: ExistingClaim[],
  gone: Set<string>,
): Promise<number> {
  const moves = existing.flatMap((fact) =>
    fact.members
      .filter((m) => !gone.has(m.id))
      .flatMap((m) =>
        m.sources
          .filter((s) => s.foundAt !== null && s.foundAt !== s.paragraphIndex)
          .map((s) => ({ claimId: m.id, sourceId: s.id, quote: s.quote, paragraphIndex: s.foundAt! })),
      ),
  )
  if (moves.length === 0) return 0

  await db.delete(claimSources).where(
    and(
      eq(claimSources.userId, userId),
      inArray(
        claimSources.id,
        moves.map((m) => m.sourceId),
      ),
    ),
  )

  const inserted = await db
    .insert(claimSources)
    .values(
      moves.map((m) => ({
        userId,
        claimId: m.claimId,
        documentId: context.documentId,
        documentName: context.documentName,
        quote: m.quote,
        paragraphIndex: m.paragraphIndex,
        ...(context.headRevisionId && { documentRevisionId: context.headRevisionId }),
      })),
    )
    .onConflictDoNothing()
    .returning({ id: claimSources.id })

  return inserted.length
}

function snapshot(fact: ExistingClaim): RetractedClaim {
  return {
    subject: fact.subjectName,
    subjectType: fact.subjectType,
    predicate: fact.predicate,
    object: fact.objectName,
    objectType: fact.objectType,
    value: fact.value,
    startTime: fact.startTime,
    endTime: fact.endTime,
    quotes: (fact.members[0]?.sources ?? []).map((s) => ({
      paragraphIndex: s.paragraphIndex,
      quote: s.quote,
    })),
  }
}

/* --------------------------------------------------------------- resolving */

async function loadIndex(
  db: NeonDatabase<typeof schema>,
  userId: string,
): Promise<EntityIndex> {
  const rows = await db
    .select({
      id: entities.id,
      name: entities.name,
      entityType: entities.entityType,
      canonicity: entities.canonicity,
      normalizedName: entities.normalizedName,
      nameVariants: entities.nameVariants,
    })
    .from(entities)
    .where(eq(entities.userId, userId))

  return buildEntityIndex(rows)
}

/**
 * Resolve every distinct end referenced by the batch, once.
 *
 * Distinct ends rather than per claim: a document about one nation names it in
 * thirty claims, and resolving it thirty times would do the same edit-distance
 * work thirty times for the same answer.
 */
function resolveEnds(
  index: EntityIndex,
  extracted: ExtractedClaim[],
): {
  resolutions: Map<string, Resolution>
  creates: { proposal: DraftProposal; refKeys: string[] }[]
} {
  const ends = new Map<string, { name: string; entityType: string }>()

  for (const claim of extracted) {
    ends.set(refKey(claim.subjectName, claim.subjectType), {
      name: claim.subjectName,
      entityType: claim.subjectType,
    })
    if (claim.objectName && claim.objectType) {
      ends.set(refKey(claim.objectName, claim.objectType), {
        name: claim.objectName,
        entityType: claim.objectType,
      })
    }
  }

  const resolutions = new Map<string, Resolution>()
  /**
   * One entry per entity to create, carrying every ref key that should point at
   * it. A document naming "the Veche" and "Veche" describes one thing — the
   * matcher would already call them one match — so creating two drafts would
   * manufacture exactly the near-miss duplicate the matcher exists to prevent.
   */
  const creates = new Map<string, { proposal: DraftProposal; refKeys: string[] }>()

  for (const [key, end] of ends) {
    const result = resolve(index, end.name, { type: end.entityType })

    if (result.status === 'matched') {
      resolutions.set(key, { status: 'id', id: result.entity.id })
      continue
    }

    if (result.status === 'ambiguous') {
      resolutions.set(key, {
        status: 'ambiguous',
        message: `'${end.name}' matches ${result.candidates.length} ${end.entityType} entities; the graph cannot tell which was meant.`,
      })
      continue
    }

    // The name exists, under a type the model did not claim. That disagreement
    // is information — do not silently adopt either side's answer.
    const otherType = result.suggestions.find((s) => s.reason === 'other_type')
    if (otherType) {
      resolutions.set(key, {
        status: 'type_mismatch',
        message: `'${end.name}' is a ${otherType.entityType} in the graph, but was extracted as a ${end.entityType}.`,
      })
      continue
    }

    const looseKey = `${end.entityType}|${looseNameKey(end.name)}`
    const existing = creates.get(looseKey)
    if (existing) {
      existing.refKeys.push(key)
      continue
    }
    creates.set(looseKey, { proposal: end, refKeys: [key] })
  }

  return { resolutions, creates: [...creates.values()] }
}

/**
 * Turn a claim's two resolutions into ids, or into the reason it cannot be
 * written. A discriminated union rather than a boolean so the caller gets the
 * ids already narrowed — there is no path that reaches an insert holding an
 * unresolved end.
 */
function claimEnds(
  index: number,
  claim: ExtractedClaim,
  subject: Resolution | null | undefined,
  object: Resolution | null | undefined,
):
  | { ok: true; subjectId: string; objectId: string | null }
  | { ok: false; unwritten: UnwrittenClaim } {
  const refuse = (code: UnwrittenClaim['code'], message: string) =>
    ({ ok: false as const, unwritten: { index, code, message, claim } })

  for (const [role, resolution] of [
    ['subject', subject],
    ['object', object],
  ] as const) {
    if (!resolution) {
      if (role === 'object') continue
      // Only reachable if draft creation skipped the name — a blank one, which
      // parseExtraction already refuses. Reported rather than thrown, because a
      // write path that throws loses the other twenty-nine good claims.
      return refuse('entity_unresolved', `'${claim.subjectName}' could not be resolved or created.`)
    }
    if (resolution.status === 'ambiguous') return refuse('entity_ambiguous', resolution.message)
    if (resolution.status === 'type_mismatch') {
      return refuse('entity_type_mismatch', resolution.message)
    }
  }

  const subjectId = (subject as { status: 'id'; id: string }).id
  const objectId = object ? (object as { status: 'id'; id: string }).id : null

  // A self-relation survives parseExtraction only when the two *names* differ
  // but resolve to one entity — an alias meeting its own entity. The catalog
  // would take it; the graph would be asserting that a thing rules itself.
  if (objectId && objectId === subjectId) {
    return refuse(
      'entity_ambiguous',
      `'${claim.subjectName}' and '${claim.objectName}' are the same entity, so this claim relates it to itself.`,
    )
  }

  return { ok: true, subjectId, objectId }
}

/* ---------------------------------------------------------------- the rows */

type ClaimRow = typeof claims.$inferInsert

function buildClaimRow(
  userId: string,
  claim: ExtractedClaim,
  subjectId: string,
  objectId: string | null,
  context: ExtractionContext,
): ClaimRow {
  return {
    userId,
    subjectId,
    subjectType: claim.subjectType,
    predicate: claim.predicate,
    ...(objectId && claim.objectType && { objectId, objectType: claim.objectType }),
    ...(claim.valueInt !== undefined && { valueInt: claim.valueInt }),
    ...(claim.valueFloat !== undefined && { valueFloat: claim.valueFloat }),
    ...(claim.valueString !== undefined && { valueString: claim.valueString }),
    ...(claim.valueTime !== undefined && {
      valueTime: claim.valueTime,
      // The model may supply its own sort key; the calendar parser is the
      // fallback, and the same rule the hand-entry path uses.
      valueOrder: claim.valueOrder ?? ordinalFor(claim.valueTime) ?? undefined,
    }),
    ...(claim.startTime !== undefined && {
      startTime: claim.startTime,
      startOrder: claim.startOrder ?? ordinalFor(claim.startTime) ?? undefined,
    }),
    ...(claim.endTime !== undefined && {
      endTime: claim.endTime,
      endOrder: claim.endOrder ?? ordinalFor(claim.endTime) ?? undefined,
    }),
    // Never canon. A human promotes; an extractor proposes.
    canonicity: 'draft',
    createdBy: 'llm',
    extractedByModel: context.model,
  }
}

type WrittenClaim = {
  id: string
  inserted: boolean
  claim: ExtractedClaim
  /** An inverse this module derived, rather than a claim the model stated. */
  mirror: boolean
}

type PendingClaim = { claim: ExtractedClaim; row: ClaimRow; mirror: boolean }

/**
 * Insert the batch, and come back with an id for every row — whether this run
 * created it or a previous one did, because either way it needs its citation.
 *
 * `onConflictDoNothing` cannot do this: it returns nothing for the rows that
 * conflicted, which are exactly the ones whose ids we still need. So the
 * conflict action is a DO UPDATE that provably changes nothing — it sets
 * `subject_id` to the value already there, which a fingerprint collision
 * guarantees is identical. An existing hand-authored claim keeps its
 * `canonicity`, its `created_by` and its timestamps untouched; re-extraction
 * cannot demote a claim a person promoted.
 */
async function upsertClaims(
  db: NeonDatabase<typeof schema>,
  pending: PendingClaim[],
): Promise<WrittenClaim[]> {
  /*
   * Distinct rows only. Postgres refuses outright — "ON CONFLICT DO UPDATE
   * command cannot affect row a second time" — if one statement proposes two
   * rows with the same conflict key, so a model asserting one fact from two
   * paragraphs would otherwise take the whole extraction down with it. The
   * duplicates are not dropped: every pending claim is paired back to the row
   * below and keeps its own citation.
   */
  const distinct: ClaimRow[] = []
  const seen = new Set<string>()
  for (const { row } of pending) {
    const key = identityKey(row)
    if (seen.has(key)) continue
    seen.add(key)
    distinct.push(row)
  }

  const rows = await db
    .insert(claims)
    .values(distinct)
    .onConflictDoUpdate({
      target: [claims.userId, claims.fingerprint],
      set: { subjectId: sql`excluded.subject_id` },
    })
    .returning({
      id: claims.id,
      fingerprint: claims.fingerprint,
      // Postgres exposes whether RETURNING is describing a fresh tuple: an
      // insert leaves xmax at 0, an update leaves the deleting transaction id.
      // It is the only way to count created-vs-existing without a second query.
      inserted: sql<boolean>`(xmax = 0)`,
    })

  /*
   * Order is not guaranteed across an upsert, so rows are paired back to their
   * claims by fingerprint rather than by position.
   *
   * Two pending rows may match the same returned row, and that is correct: a
   * model that asserts one fact from two paragraphs produces one claim with two
   * citations. Both keep their quote; `writeSources` decides what is a
   * duplicate, and the counts below are taken over distinct ids.
   */
  const written: WrittenClaim[] = []

  for (const { claim, row, mirror } of pending) {
    const match = rows.find((r) => fingerprintMatches(r.fingerprint, row))
    if (match) written.push({ id: match.id, inserted: match.inserted, claim, mirror })
  }

  return written
}

/** Distinct claims, since one claim may appear in `written` once per citation. */
function countClaims(written: WrittenClaim[], inserted: boolean): number {
  return new Set(written.filter((w) => w.inserted === inserted).map((w) => w.id)).size
}

/**
 * The same fields the generated `fingerprint` column is built from, keyed
 * locally so a batch can be deduplicated before Postgres sees it.
 *
 * This is not a second definition of the fingerprint and is never compared
 * against one: it only has to agree with itself, across rows this process
 * built. Two rows it calls equal are equal by every input the catalog hashes,
 * so Postgres will agree; that is the only direction that matters.
 */
function identityKey(row: ClaimRow): string {
  return [
    row.subjectId,
    row.predicate,
    row.objectId ?? '',
    row.valueInt ?? '',
    row.valueFloat ?? '',
    row.valueString ?? '',
    row.valueTime ?? '',
    row.startTime ?? '',
    row.endTime ?? '',
  ].join('\u0000')
}

/**
 * Whether a returned fingerprint describes this row.
 *
 * The format is fixed by the generated column in src/db/schema.ts. Matching
 * rather than *computing* it is deliberate: a computed copy would be a second
 * definition free to drift from the catalog's, and the whole point of the
 * generated column is that there is one. Here the database's own value is the
 * input, and this only asks whether it belongs to the row in hand.
 */
function fingerprintMatches(fingerprint: string, row: ClaimRow): boolean {
  const parts = fingerprint.split('|')
  if (parts.length !== 9) return false

  const [subjectId, predicate, objectId, valueInt, valueFloat, valueString, valueTime, startTime, endTime] =
    parts as [string, string, string, string, string, string, string, string, string]

  return (
    subjectId === row.subjectId &&
    predicate === row.predicate &&
    objectId === (row.objectId ?? '') &&
    valueInt === (row.valueInt?.toString() ?? '') &&
    // Postgres renders a double the way it round-trips, which is not always
    // Number.prototype.toString — so compare numerically when both are numbers.
    numericMatches(valueFloat, row.valueFloat) &&
    valueString === (row.valueString ?? '') &&
    valueTime === (row.valueTime ?? '') &&
    startTime === (row.startTime ?? '') &&
    endTime === (row.endTime ?? '')
  )
}

function numericMatches(rendered: string, value: number | null | undefined): boolean {
  if (value === null || value === undefined) return rendered === ''
  return rendered !== '' && Number(rendered) === value
}

/* -------------------------------------------------------------- the sources */

/**
 * One `claim_sources` row per claim, carrying the evidence.
 *
 * Everything here is a snapshot — the document's name, the quote, the paragraph
 * — because ADR §7a requires a claim to still show what it was based on after
 * its document is gone. A citation that reads through a foreign key would go
 * blank at exactly the moment it matters most.
 *
 * Existing sources are read first rather than relying on the unique index
 * alone: `(claim_id, document_id, paragraph_index)` does not stop a duplicate
 * when the paragraph is null, because Postgres treats nulls as distinct. A
 * claim the model quoted without an anchor would otherwise gain a fresh source
 * row on every re-extraction.
 */
async function writeSources(
  db: NeonDatabase<typeof schema>,
  userId: string,
  written: WrittenClaim[],
  context: ExtractionContext,
): Promise<number> {
  const claimIds = [...new Set(written.map((w) => w.id))]

  const existing = await db
    .select({ claimId: claimSources.claimId, paragraphIndex: claimSources.paragraphIndex })
    .from(claimSources)
    .where(
      and(
        eq(claimSources.userId, userId),
        eq(claimSources.documentId, context.documentId),
        inArray(claimSources.claimId, claimIds),
      ),
    )

  const seen = new Set(existing.map((e) => `${e.claimId}|${e.paragraphIndex ?? ''}`))
  const rows: (typeof claimSources.$inferInsert)[] = []

  for (const { id, claim } of written) {
    const key = `${id}|${claim.paragraphIndex ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)

    rows.push({
      userId,
      claimId: id,
      documentId: context.documentId,
      documentName: context.documentName,
      quote: claim.quote,
      ...(claim.paragraphIndex !== undefined && { paragraphIndex: claim.paragraphIndex }),
      ...(context.headRevisionId && { documentRevisionId: context.headRevisionId }),
    })
  }

  if (rows.length === 0) return 0

  const inserted = await db
    .insert(claimSources)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: claimSources.id })

  return inserted.length
}

/* ------------------------------------------------------------- the document */

/**
 * Record what the document was read at.
 *
 * Both stamps, for the two different jobs ADR §6 separates: the revision id
 * says *which version* produced these claims, and the drive version is what a
 * later sync compares against to know the document has moved on.
 *
 * Status becomes `extracted`, never `verified` — that is a person's word, and
 * the same rule that keeps an extracted claim a draft.
 */
async function stampDocument(
  db: NeonDatabase<typeof schema>,
  userId: string,
  context: ExtractionContext,
): Promise<void> {
  await db
    .update(documents)
    .set({
      status: 'extracted',
      extractedRevisionId: context.headRevisionId,
      extractedDriveVersion: context.driveVersion,
      syncedAt: new Date(),
    })
    .where(and(eq(documents.userId, userId), eq(documents.id, context.documentId)))
}
