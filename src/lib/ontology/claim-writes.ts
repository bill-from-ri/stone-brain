import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { claims, entities } from '@/db/schema'
import { ordinalFor } from './calendar'
import { coreOntology } from './extraction'
import { normalizeName } from './matcher'

/**
 * Writing claims by hand, from the frontend.
 *
 * Two things live here that the extraction path will also need, and which are
 * easier to get right once:
 *
 *   1. **Validation before insert.** The signature foreign key would reject an
 *      illegal claim anyway, but as an opaque constraint violation. Checking
 *      against the compiled ontology first turns that into a sentence.
 *   2. **Inverse materialisation.** Relationships are directional, so asserting
 *      one direction without the other leaves a graph that answers "who rules
 *      Ashfall" but not "what does Sera rule". The reverse claim is written for
 *      the user rather than asked of them — but never silently: the editor
 *      shows exactly what it will add, and it can be declined.
 */

export type ClaimInput = {
  subjectId: string
  predicate: string
  objectId?: string | null
  value?: string | null
  startTime?: string | null
  endTime?: string | null
  /** Whether to also write the reverse direction. The UI defaults it to true. */
  createInverse?: boolean
}

export type WriteResult =
  | { ok: true; claimId: string; inverseClaimId: string | null }
  | { ok: false; error: string }

/**
 * What the reverse direction of a claim would be, in words.
 *
 * Pure, and exported so the editor can render the confirmation from the same
 * logic that performs the write — a preview computed differently from the
 * action it previews is worse than no preview.
 */
export function describeInverse(
  predicate: string,
  subjectName: string,
  objectName: string,
): { predicate: string; text: string } | null {
  const ontology = coreOntology()
  const def = ontology.byName.get(predicate)
  if (!def || def.kind !== 'relationship' || !def.inverseName) return null

  return {
    predicate: def.inverseName,
    // Symmetric predicates name themselves, so this reads correctly for both
    // `married_to` (same verb, swapped ends) and `rules` / `ruled_by`.
    text: `${objectName} — ${def.inverseName} → ${subjectName}`,
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

function timeColumns(startTime: string | null, endTime: string | null) {
  const startOrder = startTime ? ordinalFor(startTime) : null
  const endOrder = endTime ? ordinalFor(endTime) : null
  return {
    ...(startTime && { startTime, ...(startOrder !== null && { startOrder }) }),
    ...(endTime && { endTime, ...(endOrder !== null && { endOrder }) }),
  }
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

  const [row] = await db
    .insert(claims)
    .values({
      userId,
      subjectId: subject.id,
      subjectType: subject.entityType,
      predicate: input.predicate,
      ...(object && { objectId: object.id, objectType: object.entityType }),
      ...valueColumns(input.predicate, value),
      ...times,
      canonicity: 'canon',
      createdBy: 'user',
    })
    // The fingerprint index makes re-asserting the same claim a no-op rather
    // than a duplicate, so a double-submit costs nothing.
    .onConflictDoNothing()
    .returning({ id: claims.id })

  if (!row) return { ok: false, error: 'That claim already exists.' }

  let inverseClaimId: string | null = null

  const def = coreOntology().byName.get(input.predicate)
  if (input.createInverse !== false && object && def?.inverseName) {
    const [inverse] = await db
      .insert(claims)
      .values({
        userId,
        subjectId: object.id,
        subjectType: object.entityType,
        predicate: def.inverseName,
        objectId: subject.id,
        objectType: subject.entityType,
        ...times,
        canonicity: 'canon',
        createdBy: 'user',
      })
      .onConflictDoNothing()
      .returning({ id: claims.id })

    inverseClaimId = inverse?.id ?? null
  }

  return { ok: true, claimId: row.id, inverseClaimId }
}

/**
 * Deletes a claim, and optionally the reverse direction that was written with
 * it. Not automatic: the inverse may have been asserted independently or carry
 * its own sources, so removing it is offered rather than assumed.
 */
export async function deleteClaim(
  userId: string,
  claimId: string,
  withInverse: boolean,
): Promise<{ deleted: number }> {
  const [claim] = await db
    .select({
      subjectId: claims.subjectId,
      objectId: claims.objectId,
      predicate: claims.predicate,
    })
    .from(claims)
    .where(and(eq(claims.userId, userId), eq(claims.id, claimId)))
    .limit(1)

  if (!claim) return { deleted: 0 }

  let deleted = 0
  await db.delete(claims).where(and(eq(claims.userId, userId), eq(claims.id, claimId)))
  deleted++

  const def = coreOntology().byName.get(claim.predicate)
  if (withInverse && claim.objectId && def?.inverseName) {
    const removed = await db
      .delete(claims)
      .where(
        and(
          eq(claims.userId, userId),
          eq(claims.subjectId, claim.objectId),
          eq(claims.objectId, claim.subjectId),
          eq(claims.predicate, def.inverseName),
        ),
      )
      .returning({ id: claims.id })
    deleted += removed.length
  }

  return { deleted }
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

async function loadEntity(userId: string, id: string) {
  const [row] = await db
    .select({ id: entities.id, name: entities.name, entityType: entities.entityType })
    .from(entities)
    .where(and(eq(entities.userId, userId), eq(entities.id, id)))
    .limit(1)
  return row ?? null
}
