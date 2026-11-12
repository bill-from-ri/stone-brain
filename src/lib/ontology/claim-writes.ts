import 'server-only'
import { and, count, eq, or } from 'drizzle-orm'
import type { NeonDatabase } from 'drizzle-orm/neon-serverless'
import { db } from '@/db'
import type * as schema from '@/db/schema'
import { claims, entities } from '@/db/schema'
import { ordinalFor } from './calendar'
import { coreOntology } from './extraction'
import { inverseOf, inversePredicate } from './inverse'
import { copySources, findAssertion, materialiseInverse, type Assertion } from './inverse-write'
import { normalizeName } from './matcher'

/**
 * Writing claims by hand, from the frontend.
 *
 * Two things live here:
 *
 *   1. **Validation before insert.** The signature foreign key would reject an
 *      illegal claim anyway, but as an opaque constraint violation. Checking
 *      against the compiled ontology first turns that into a sentence.
 *   2. **Both directions, always.** Relationships are directional, so every
 *      relationship claim has its inverse materialised beside it (see
 *      `inverse.ts`) — and here, where a person can also edit and delete, the
 *      two directions are kept as one fact: creating, editing or deleting one
 *      does the same to the other, in the same transaction. The editor says
 *      what the second write will be, so it is never a surprise; it is no
 *      longer a choice, because a graph where "Sera rules Ashfall" survives the
 *      deletion of "Ashfall is ruled by Sera" contradicts itself.
 */

type Db = NeonDatabase<typeof schema>

export type ClaimInput = {
  subjectId: string
  predicate: string
  objectId?: string | null
  value?: string | null
  startTime?: string | null
  endTime?: string | null
}

/**
 * An edit to an existing claim. The subject and predicate are fixed — changing
 * either makes it a different claim, which is a delete and a create — so what
 * can move is the other end and the dates. An absent field is left as it is;
 * a date set to `null` is cleared.
 */
export type ClaimPatch = {
  objectId?: string
  value?: string
  startTime?: string | null
  endTime?: string | null
}

export type WriteResult =
  | { ok: true; claimId: string; inverseClaimId: string | null }
  | { ok: false; error: string }

/**
 * What the reverse direction of a claim would be, in words.
 *
 * Pure, and exported so a preview can be rendered from the same vocabulary
 * that performs the write — a preview computed differently from the action it
 * previews is worse than no preview.
 */
export function describeInverse(
  predicate: string,
  subjectName: string,
  objectName: string,
): { predicate: string; text: string } | null {
  const inverse = inversePredicate(predicate)
  if (!inverse) return null

  return {
    predicate: inverse,
    // Symmetric predicates name themselves, so this reads correctly for both
    // `married_to` (same verb, swapped ends) and `rules` / `ruled_by`.
    text: `${objectName} — ${inverse} → ${subjectName}`,
  }
}

/** Validates against the compiled ontology; returns a readable reason or null. */
function check(
  predicate: string,
  subjectType: string,
  objectType: string | null,
  value: string | null,
): string | null {
  const ontology = coreOntology()
  const def = ontology.byName.get(predicate)
  if (!def) return `'${predicate}' is not in the vocabulary.`

  const subjects = ontology.subjects.get(predicate) ?? new Set<string>()
  if (!subjects.has(subjectType)) {
    return `'${def.label}' does not accept a ${subjectType} as subject. Legal subjects: ${[...subjects].sort().join(', ')}.`
  }

  if (def.kind === 'relationship') {
    if (!objectType) return `'${def.label}' is a relationship and needs a second entity.`
    const objects = ontology.objects.get(`${predicate}|${subjectType}`) ?? new Set<string>()
    if (!objects.has(objectType)) {
      return `'${def.label}' from a ${subjectType} does not accept a ${objectType}. Legal: ${[...objects].sort().join(', ')}.`
    }
    return null
  }

  if (objectType) return `'${def.label}' is an attribute and takes a value, not an entity.`
  if (value === null || value.trim() === '') return `'${def.label}' needs a value.`

  if (def.valueEnum && !def.valueEnum.includes(value)) {
    return `'${def.label}' accepts only: ${def.valueEnum.join(', ')}.`
  }
  if ((def.valueType === 'int' || def.valueType === 'float') && !Number.isFinite(Number(value))) {
    return `'${def.label}' takes a number.`
  }
  if (def.valueType === 'int' && !Number.isInteger(Number(value))) {
    return `'${def.label}' takes a whole number.`
  }

  return null
}

/** Routes a value into the column its predicate declares. */
function valueColumns(predicate: string, value: string | null) {
  const def = coreOntology().byName.get(predicate)
  if (!def || def.kind !== 'attribute' || value === null) return {}

  switch (def.valueType) {
    case 'int':
      return { valueInt: Number(value) }
    case 'float':
      return { valueFloat: Number(value) }
    case 'date': {
      const order = ordinalFor(value)
      return { valueTime: value, ...(order !== null && { valueOrder: order }) }
    }
    default:
      return { valueString: value }
  }
}

/**
 * The validity window's four columns, explicitly — `null` included, so the same
 * object serves an insert and an edit that clears a date. An unreadable label
 * keeps its text and loses only its ordering.
 */
function timeColumns(startTime: string | null, endTime: string | null) {
  return {
    startTime,
    startOrder: startTime ? ordinalFor(startTime) : null,
    endTime,
    endOrder: endTime ? ordinalFor(endTime) : null,
  }
}

/**
 * The catalog's `claims_time_order` check, asked first so it can be a sentence.
 * Only decidable when both labels parse; an unordered label cannot be wrong.
 */
function timeProblem(times: ReturnType<typeof timeColumns>): string | null {
  const { startOrder, endOrder } = times
  if (startOrder === null || endOrder === null || endOrder >= startOrder) return null
  return `'${times.endTime}' is before '${times.startTime}'.`
}

export async function createClaim(userId: string, input: ClaimInput): Promise<WriteResult> {
  const subject = await loadEntity(userId, input.subjectId)
  if (!subject) return { ok: false, error: 'That subject entity no longer exists.' }

  const object = input.objectId ? await loadEntity(userId, input.objectId) : null
  if (input.objectId && !object) return { ok: false, error: 'That object entity no longer exists.' }

  const value = input.value?.trim() || null
  const problem = check(input.predicate, subject.entityType, object?.entityType ?? null, value)
  if (problem) return { ok: false, error: problem }

  if (object && object.id === subject.id) {
    return { ok: false, error: 'A claim cannot relate an entity to itself.' }
  }

  const times = timeColumns(input.startTime?.trim() || null, input.endTime?.trim() || null)
  const timeError = timeProblem(times)
  if (timeError) return { ok: false, error: timeError }

  const values = {
    userId,
    subjectId: subject.id,
    subjectType: subject.entityType,
    predicate: input.predicate,
    objectId: object?.id ?? null,
    objectType: object?.entityType ?? null,
    ...valueColumns(input.predicate, value),
    ...times,
    canonicity: 'canon' as const,
    createdBy: 'user' as const,
  }

  // One transaction, so there is no moment — and no failure — at which the
  // graph holds one direction of a relationship without the other.
  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db

    const [row] = await tx
      .insert(claims)
      .values(values)
      // The fingerprint index makes re-asserting the same claim a no-op rather
      // than a duplicate, so a double-submit costs nothing.
      .onConflictDoNothing()
      .returning({ id: claims.id })

    if (!row) return { ok: false, error: 'That claim already exists.' } as const

    // An inverse that already exists — asserted on its own earlier — is
    // adopted rather than duplicated, and from here on travels with this one.
    const inverse = await materialiseInverse(tx, { ...values, id: row.id })
    return { ok: true, claimId: row.id, inverseClaimId: inverse?.id ?? null } as const
  })
}

/**
 * Edits a claim and its inverse together.
 *
 * The row is updated in place rather than replaced, which is what lets an
 * edited claim keep everything attached to its id: an extracted claim's
 * citations stay its citations, and its provenance stays what it was — a
 * person correcting the date on an extracted claim has not thereby written it.
 *
 * The inverse is found as it stood *before* the edit, by its swapped ends and
 * old dates, and moved with it. If the edit makes the claim identical to one
 * already in the graph, nothing is written and the collision comes back as a
 * sentence; if it makes the *inverse* identical to an existing claim, that
 * claim is adopted as the inverse and the old one retired, exactly as
 * `createClaim` adopts one.
 */
export async function updateClaim(
  userId: string,
  claimId: string,
  patch: ClaimPatch,
): Promise<WriteResult> {
  const [current] = await db
    .select()
    .from(claims)
    .where(and(eq(claims.userId, userId), eq(claims.id, claimId)))
    .limit(1)

  if (!current) return { ok: false, error: 'That claim no longer exists.' }

  const def = coreOntology().byName.get(current.predicate)
  if (!def) return { ok: false, error: `'${current.predicate}' is not in the vocabulary.` }

  if (def.kind === 'relationship' && patch.value?.trim()) {
    return { ok: false, error: `'${def.label}' is a relationship and takes an entity, not a value.` }
  }

  const objectId = patch.objectId ?? current.objectId
  const object = objectId ? await loadEntity(userId, objectId) : null
  if (objectId && !object) return { ok: false, error: 'That object entity no longer exists.' }

  const value = patch.value !== undefined ? patch.value.trim() || null : renderValue(current)
  const problem = check(current.predicate, current.subjectType, object?.entityType ?? null, value)
  if (problem) return { ok: false, error: problem }

  if (object && object.id === current.subjectId) {
    return { ok: false, error: 'A claim cannot relate an entity to itself.' }
  }

  const times = timeColumns(
    patch.startTime === undefined ? current.startTime : patch.startTime?.trim() || null,
    patch.endTime === undefined ? current.endTime : patch.endTime?.trim() || null,
  )
  const timeError = timeProblem(times)
  if (timeError) return { ok: false, error: timeError }

  const next = {
    objectId: object?.id ?? null,
    objectType: object?.entityType ?? null,
    // Every value column, cleared and then set, so changing a value can never
    // leave the old one behind beside it — the arity check would refuse that.
    valueInt: null,
    valueFloat: null,
    valueString: null,
    valueTime: null,
    valueOrder: null,
    ...valueColumns(current.predicate, value),
    ...times,
  }

  const updated = { ...current, ...next }
  const duplicate = await findAssertion(db, userId, updated, { excludeId: claimId })
  if (duplicate) return { ok: false, error: 'An identical claim already exists.' }

  try {
    return await db.transaction(async (raw) => {
      const tx = raw as unknown as Db

      const oldInverse = await findInverse(tx, current)

      await tx
        .update(claims)
        .set({ ...next, updatedAt: new Date() })
        .where(and(eq(claims.userId, userId), eq(claims.id, claimId)))

      const inverse = inverseOf(updated)
      if (!inverse) {
        // Unreachable for today's vocabulary, where every relationship has an
        // inverse; kept honest for a predicate that one day might not.
        return { ok: true, claimId, inverseClaimId: null } as const
      }

      const target = await findAssertion(tx, userId, asAssertion(inverse), {
        excludeId: oldInverse?.id,
      })

      if (!target && oldInverse) {
        // The usual case: move the inverse with the claim. In place, so its
        // id — and anything a conflict dismissal has pinned to it — survives.
        await tx
          .update(claims)
          .set({
            subjectId: inverse.subjectId,
            subjectType: inverse.subjectType,
            objectId: inverse.objectId,
            objectType: inverse.objectType,
            ...times,
            updatedAt: new Date(),
          })
          .where(and(eq(claims.userId, userId), eq(claims.id, oldInverse.id)))
        await copySources(tx, userId, claimId, oldInverse.id)
        return { ok: true, claimId, inverseClaimId: oldInverse.id } as const
      }

      if (oldInverse) {
        await tx
          .delete(claims)
          .where(and(eq(claims.userId, userId), eq(claims.id, oldInverse.id)))
      }

      // Either the edit made the inverse a claim already in the graph, which is
      // adopted, or there was no inverse to move (a row older than the
      // invariant), which is written now. `materialiseInverse` does both.
      const written = await materialiseInverse(tx, updated)
      return { ok: true, claimId, inverseClaimId: written?.id ?? null } as const
    })
  } catch (error) {
    // The checks above ran outside the transaction, so a concurrent write can
    // still beat this one to the fingerprint. The index is the arbiter; this
    // only turns its verdict into the same sentence.
    if (isUniqueViolation(error)) return { ok: false, error: 'An identical claim already exists.' }
    throw error
  }
}

/**
 * Deletes a claim and its inverse.
 *
 * Always both. The inverse is not an independent fact that happens to agree —
 * it is the same fact read from the other end — so deleting one direction and
 * keeping the other would leave the graph asserting what the user just
 * retracted. It is matched on its swapped ends, inverse predicate and the same
 * dates: the claim's own reverse, not some other claim between the same two
 * entities at a different time.
 */
export async function deleteClaim(
  userId: string,
  claimId: string,
): Promise<{ deleted: number }> {
  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db

    const [claim] = await tx
      .select()
      .from(claims)
      .where(and(eq(claims.userId, userId), eq(claims.id, claimId)))
      .limit(1)

    if (!claim) return { deleted: 0 }

    const inverse = await findInverse(tx, claim)
    const ids = [claim.id, ...(inverse ? [inverse.id] : [])]

    const removed = await tx
      .delete(claims)
      .where(and(eq(claims.userId, userId), or(...ids.map((id) => eq(claims.id, id)))))
      .returning({ id: claims.id })

    return { deleted: removed.length }
  })
}

/* ------------------------------------------------------------- the inverse */

type StoredClaim = typeof claims.$inferSelect

/** The claim that is this one's reverse direction, as it currently stands. */
async function findInverse(tx: Db, claim: StoredClaim): Promise<{ id: string } | null> {
  const inverse = inverseOf(claim)
  return inverse ? findAssertion(tx, claim.userId, asAssertion(inverse)) : null
}

function asAssertion(row: typeof claims.$inferInsert): Assertion {
  return {
    subjectId: row.subjectId,
    predicate: row.predicate,
    objectId: row.objectId,
    valueInt: row.valueInt,
    valueFloat: row.valueFloat,
    valueString: row.valueString,
    valueTime: row.valueTime,
    startTime: row.startTime,
    endTime: row.endTime,
  }
}

/** An attribute claim's value as the editor shows it — the one populated column. */
function renderValue(row: StoredClaim): string | null {
  return row.valueString ?? row.valueTime ?? row.valueInt?.toString() ?? row.valueFloat?.toString() ?? null
}

/**
 * Postgres' unique_violation, through whatever the driver wrapped it in —
 * Drizzle nests the database error as `cause`.
 */
function isUniqueViolation(error: unknown): boolean {
  for (let e = error; e && typeof e === 'object'; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === '23505') return true
  }
  return false
}

/**
 * Creates an entity, deliberately and on the user's say-so.
 *
 * Kept out of the matcher, which never writes (ADR §15). The claim editor needs
 * it because a claim about something not yet in the graph is otherwise
 * impossible to enter — but it is an explicit action with its own button, not a
 * side effect of failing to resolve a name.
 */
export async function createEntity(
  userId: string,
  name: string,
  entityType: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, error: 'A name is required.' }

  const [row] = await db
    .insert(entities)
    .values({
      userId,
      entityType,
      name: trimmed,
      normalizedName: normalizeName(trimmed),
      canonicity: 'canon',
      createdBy: 'user',
    })
    .returning({ id: entities.id })

  return row ? { ok: true, id: row.id } : { ok: false, error: 'Could not create that entity.' }
}

/**
 * Deletes an entity, and reports how many claims went with it.
 *
 * The claims are not deleted here: both of `claims`' entity foreign keys are
 * ON DELETE CASCADE, so removing the row removes every claim it is either end
 * of, in the same statement. That is the right behaviour — a claim whose
 * subject no longer exists is not a claim about anything — but it makes this
 * the most destructive action in the product, so the count is returned *first*
 * and separately by `entityClaimCount` below, for the confirmation to name
 * before the user agrees to it.
 *
 * Returns `deleted: 0` for an id that is not this user's, on the same rule as
 * every query in db/queries: an unscoped write is a scope-check bypass.
 */
export async function deleteEntity(
  userId: string,
  entityId: string,
): Promise<{ deleted: number; claimsDeleted: number }> {
  const claimsDeleted = await entityClaimCount(userId, entityId)

  const removed = await db
    .delete(entities)
    .where(and(eq(entities.userId, userId), eq(entities.id, entityId)))
    .returning({ id: entities.id })

  return { deleted: removed.length, claimsDeleted: removed.length ? claimsDeleted : 0 }
}

/** Claims with this entity at either end — what a deletion would cascade to. */
export async function entityClaimCount(userId: string, entityId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(claims)
    .where(
      and(
        eq(claims.userId, userId),
        or(eq(claims.subjectId, entityId), eq(claims.objectId, entityId)),
      ),
    )

  return row?.n ?? 0
}

async function loadEntity(userId: string, id: string) {
  const [row] = await db
    .select({ id: entities.id, name: entities.name, entityType: entities.entityType })
    .from(entities)
    .where(and(eq(entities.userId, userId), eq(entities.id, id)))
    .limit(1)
  return row ?? null
}
