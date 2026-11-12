import { aliasedTable, and, eq, inArray, or, sql } from 'drizzle-orm'
import type { NeonDatabase } from 'drizzle-orm/neon-serverless'
import type * as schema from '@/db/schema'
import { claims, entities, entityTypes, predicateSignatures, predicates } from '@/db/schema'
import { variantsToAdd } from './names'
import type { MergePlan } from './types'

/**
 * Merging two entities into one: what the lead did by hand to `giants` and
 * `Giant`, as a service the Conflicts screen calls.
 *
 * Takes the database handle rather than importing the app's, like
 * `src/lib/conflicts/load.ts`, so it runs against PGlite in tests;
 * `src/db/queries/duplicates.ts` binds it to the real one.
 *
 * The preview and the merge are one computation. `planMerge` runs it and
 * stops; `mergeEntities` runs it inside a transaction with both entity rows
 * locked, and writes what it found only when it found nothing in the way. A
 * preview computed differently from the action it previews is worse than no
 * preview, so there is no second code path to drift.
 *
 * What moves, claim by claim, for keep K and drop D:
 *
 *   - a **twin** — a claim on D that, with D's id replaced by K's, is a claim
 *     K already has — is *folded*: its citations move onto K's claim and the
 *     copy goes;
 *   - any other claim is **repointed**: its D end becomes K, id and type
 *     together, since the claim → entity foreign key is on both;
 *   - when K is of another type and a claim's predicate will not take it, the
 *     claim may be **recast** to a predicate that will (see `RECAST`);
 *   - and anything still unfit is a **blocker**, and with any blocker nothing
 *     is written.
 *
 * The rule for a claim *between* K and D — `Innenbeck Province located in
 * Province of Innenbeck` — is that it blocks. After the merge it would connect
 * K to itself, which the schema forbids and which no predicate means. Dropping
 * it silently would be the merge deciding that the claim was wrong; the person
 * deleting it first is the same outcome with the decision left to them, and
 * the blocker says so.
 */

type Db = NeonDatabase<typeof schema>

/**
 * Predicates a claim may be recast to when the survivor's type will not take
 * the one it has. Both the `located_in`/`member_of` pair and their inverses,
 * so a relationship and its materialised reverse always recast together:
 * `Gabelford located in Innenbeck Province` and `Innenbeck Province contains
 * Gabelford` become `member of` and `has member` in one merge, never one
 * without the other. A test holds the table to that.
 *
 * It is the one translation the corpus has needed so far — a region folded
 * into the society that governs it, and back — and it stays small on purpose.
 * A recast is a claim changing meaning; each entry here is a judgement that
 * the two predicates say the same thing about that pair of types.
 *
 * A recast happens only where the original does not fit and the recast
 * predicate's signature accepts the claim, so the table can name both
 * directions without a claim ever bouncing between them.
 */
export const RECAST: Readonly<Record<string, string>> = {
  located_in: 'member_of',
  contains: 'has_member',
  member_of: 'located_in',
  has_member: 'contains',
}

/** A claim at D's end, with what the plan needs to say about it. */
type ClaimRow = {
  id: string
  subjectId: string
  subjectType: string
  subjectName: string
  predicate: string
  predicateLabel: string
  objectId: string | null
  objectType: string | null
  objectName: string | null
  valueKind: string
  valueInt: number | null
  valueFloat: number | null
  valueString: string | null
  valueTime: string | null
  startTime: string | null
  endTime: string | null
}

/** What will be written for one claim. */
type Move =
  | { kind: 'fold'; claimId: string; into: string }
  | {
      kind: 'repoint'
      claimId: string
      subject: { id: string; type: string } | null
      object: { id: string; type: string } | null
      predicate: string
    }

type EntityRow = {
  id: string
  name: string
  entityType: string
  nameVariants: string[]
  canonicity: string
  summary: string | null
  sourceDocumentId: string | null
}

type Computed = { plan: MergePlan; moves: Move[]; keep: EntityRow; drop: EntityRow }

/**
 * What merging `dropId` into `keepId` would do. Writes nothing.
 *
 * Null when either entity is not this user's (or does not exist), or the two
 * ids are one entity — the route answers those before any plan is shown.
 */
export async function planMerge(
  db: Db,
  userId: string,
  keepId: string,
  dropId: string,
): Promise<MergePlan | null> {
  return (await compute(db, userId, keepId, dropId, false))?.plan ?? null
}

/**
 * Merges `dropId` into `keepId`, in one transaction, and returns what it did.
 *
 * With a blocker the plan comes back with `blockers` filled and nothing
 * written; null as for `planMerge`. Both entity rows are locked for the
 * duration, so a claim written to D by another request mid-merge either lands
 * before the plan is computed (and moves) or waits and fails on D's absence —
 * never orphaned on an entity that no longer exists.
 */
export async function mergeEntities(
  db: Db,
  userId: string,
  keepId: string,
  dropId: string,
): Promise<MergePlan | null> {
  return db.transaction(async (raw) => {
    // Drizzle types a transaction as its own handle; every query here is one
    // both support (see the note in extraction-write.ts).
    const tx = raw as unknown as Db
    const computed = await compute(tx, userId, keepId, dropId, true)
    if (!computed) return null
    if (computed.plan.blockers.length > 0) return computed.plan

    await write(tx, userId, computed)
    return computed.plan
  })
}

/* --------------------------------------------------------------- computing */

const subject = aliasedTable(entities, 'subject')
const object = aliasedTable(entities, 'object')

async function compute(
  db: Db,
  userId: string,
  keepId: string,
  dropId: string,
  lock: boolean,
): Promise<Computed | null> {
  if (keepId === dropId) return null

  const pair = db
    .select({
      id: entities.id,
      name: entities.name,
      entityType: entities.entityType,
      nameVariants: entities.nameVariants,
      canonicity: entities.canonicity,
      summary: entities.summary,
      sourceDocumentId: entities.sourceDocumentId,
    })
    .from(entities)
    .where(and(eq(entities.userId, userId), inArray(entities.id, [keepId, dropId])))
  const rows = lock ? await pair.for('update') : await pair
  const keep = rows.find((r) => r.id === keepId)
  const drop = rows.find((r) => r.id === dropId)
  if (!keep || !drop) return null

  const [onDrop, onKeep, typeRows] = await Promise.all([
    claimsAt(db, userId, dropId),
    claimsAt(db, userId, keepId),
    db.select({ name: entityTypes.name, label: entityTypes.label }).from(entityTypes),
  ])
  const typeLabel = new Map(typeRows.map((t) => [t.name, t.label.toLowerCase()]))
  const label = (type: string) => typeLabel.get(type) ?? type

  // Only a change of type can make a claim unfit, so only then are the
  // signatures read.
  const retyped = keep.entityType !== drop.entityType
  const fits = retyped ? await signatureCheck(db, onDrop) : () => true

  // Assertions K's end already makes, and those this merge will make, so a
  // claim that would collide with either folds instead.
  const taken = new Map<string, string>()
  for (const c of onKeep) taken.set(assertionKey(c), c.id)

  const plan: MergePlan = {
    keep: { id: keep.id, name: keep.name, entityType: keep.entityType },
    drop: { id: drop.id, name: drop.name, entityType: drop.entityType },
    repointed: 0,
    folded: 0,
    recast: [],
    variantsAdded: variantsToAdd(keep, drop),
    blockers: [],
  }
  const moves: Move[] = []

  for (const c of onDrop) {
    const sentence = sentenceOf(c)
    const atSubject = c.subjectId === dropId
    const otherEnd = atSubject ? c.objectId : c.subjectId
    if (otherEnd === keepId) {
      plan.blockers.push({
        claimId: c.id,
        sentence,
        reason: `After the merge this would connect ${keep.name} to itself. Delete it first if the two are one thing.`,
      })
      continue
    }

    const newSubject = atSubject ? { id: keepId, type: keep.entityType } : null
    const newObject = atSubject ? null : { id: keepId, type: keep.entityType }
    const subjectType = newSubject?.type ?? c.subjectType
    const objectType = newObject?.type ?? c.objectType

    let predicate = c.predicate
    if (!fits(predicate, subjectType, objectType, c.valueKind)) {
      const recast = RECAST[predicate]
      if (recast && fits(recast, subjectType, objectType, c.valueKind)) {
        predicate = recast
      } else {
        plan.blockers.push({ claimId: c.id, sentence, reason: unfitReason(c, subjectType, objectType, label) })
        continue
      }
    }

    const key = assertionKey({
      ...c,
      subjectId: newSubject?.id ?? c.subjectId,
      objectId: newObject?.id ?? c.objectId,
      predicate,
    })
    const twin = taken.get(key)
    if (twin) {
      moves.push({ kind: 'fold', claimId: c.id, into: twin })
      plan.folded++
      continue
    }
    taken.set(key, c.id)

    moves.push({ kind: 'repoint', claimId: c.id, subject: newSubject, object: newObject, predicate })
    if (predicate === c.predicate) plan.repointed++
    else plan.recast.push({ claimId: c.id, from: c.predicate, to: predicate, sentence })
  }

  return { plan, moves, keep, drop }
}

/** Every claim with `entityId` at either end, with names for the sentences. */
function claimsAt(db: Db, userId: string, entityId: string): Promise<ClaimRow[]> {
  return db
    .select({
      id: claims.id,
      subjectId: claims.subjectId,
      subjectType: claims.subjectType,
      subjectName: subject.name,
      predicate: claims.predicate,
      predicateLabel: predicates.label,
      objectId: claims.objectId,
      objectType: claims.objectType,
      objectName: object.name,
      valueKind: claims.valueKind,
      valueInt: claims.valueInt,
      valueFloat: claims.valueFloat,
      valueString: claims.valueString,
      valueTime: claims.valueTime,
      startTime: claims.startTime,
      endTime: claims.endTime,
    })
    .from(claims)
    .innerJoin(predicates, eq(predicates.name, claims.predicate))
    .innerJoin(subject, eq(subject.id, claims.subjectId))
    .leftJoin(object, eq(object.id, claims.objectId))
    .where(and(eq(claims.userId, userId), or(eq(claims.subjectId, entityId), eq(claims.objectId, entityId))))
    .orderBy(claims.createdAt, claims.id)
}

/**
 * A test against `predicate_signatures` — the catalog the signature foreign
 * key checks, so "fits" here is exactly "the write will be accepted". Read
 * for the predicates the claims carry and their recasts only.
 */
async function signatureCheck(db: Db, rows: ClaimRow[]) {
  const names = new Set<string>()
  for (const r of rows) {
    names.add(r.predicate)
    const recast = RECAST[r.predicate]
    if (recast) names.add(recast)
  }
  const signatures =
    names.size === 0
      ? []
      : await db
          .select({
            predicate: predicateSignatures.predicate,
            subjectType: predicateSignatures.subjectType,
            objectType: predicateSignatures.objectType,
            valueKind: predicateSignatures.valueKind,
          })
          .from(predicateSignatures)
          .where(inArray(predicateSignatures.predicate, [...names]))
  const legal = new Set(signatures.map((s) => `${s.predicate}|${s.subjectType}|${s.objectType}|${s.valueKind}`))
  return (predicate: string, subjectType: string, objectType: string | null, valueKind: string) =>
    legal.has(`${predicate}|${subjectType}|${objectType ?? '@none'}|${valueKind}`)
}

/**
 * A claim's identity as an assertion — the columns the generated
 * `fingerprint` is built from, with null read as empty just as its
 * `coalesce`s read it. Compared only within this module, against rows read
 * in the same transaction; it is never written or matched against the stored
 * fingerprint, so it cannot drift from that one into a wrong write.
 */
function assertionKey(c: {
  subjectId: string
  predicate: string
  objectId: string | null
  valueInt: number | null
  valueFloat: number | null
  valueString: string | null
  valueTime: string | null
  startTime: string | null
  endTime: string | null
}): string {
  return [
    c.subjectId,
    c.predicate,
    c.objectId ?? '',
    c.valueInt === null ? '' : String(c.valueInt),
    c.valueFloat === null ? '' : String(c.valueFloat),
    c.valueString ?? '',
    c.valueTime ?? '',
    c.startTime ?? '',
    c.endTime ?? '',
  ].join('|')
}

function valueOf(c: ClaimRow): string {
  return (
    c.valueString ??
    c.valueTime ??
    (c.valueInt !== null ? String(c.valueInt) : null) ??
    (c.valueFloat !== null ? String(c.valueFloat) : '')
  )
}

/** "Gabelford located in Innenbeck Province" — the claim as it reads now. */
function sentenceOf(c: ClaimRow): string {
  return `${c.subjectName} ${c.predicateLabel.toLowerCase()} ${c.objectName ?? valueOf(c)}`
}

function unfitReason(
  c: ClaimRow,
  subjectType: string,
  objectType: string | null,
  label: (type: string) => string,
): string {
  const verb = `“${c.predicateLabel.toLowerCase()}”`
  if (objectType === null) return `A ${label(subjectType)} cannot have ${verb}.`
  return `${verb} does not connect a ${label(subjectType)} to a ${label(objectType)}.`
}

/* ------------------------------------------------------------------ writing */

async function write(tx: Db, userId: string, { moves, keep, drop }: Computed) {
  for (const move of moves) {
    if (move.kind === 'fold') {
      // Every column of every citation, so the folded claim's evidence reads
      // exactly as it did. The NOT EXISTS is the unique index's blind spot: a
      // null paragraph is distinct from every other, so a citation with no
      // anchor would otherwise land twice (see `copySources`).
      await tx.execute(sql`
        insert into claim_sources
          (user_id, claim_id, document_id, document_name, quote, paragraph_index,
           document_revision_id, created_at)
        select s.user_id, ${move.into}::uuid, s.document_id, s.document_name, s.quote,
               s.paragraph_index, s.document_revision_id, s.created_at
        from claim_sources s
        where s.user_id = ${userId}::uuid
          and s.claim_id = ${move.claimId}::uuid
          and not exists (
            select 1 from claim_sources t
            where t.claim_id = ${move.into}::uuid
              and t.document_id is not distinct from s.document_id
              and t.paragraph_index is not distinct from s.paragraph_index
          )
        on conflict do nothing
      `)
      await tx.delete(claims).where(and(eq(claims.userId, userId), eq(claims.id, move.claimId)))
      continue
    }

    // One statement per claim, so the end's id and type change together and
    // the signature key is checked against the new predicate in the same row.
    await tx
      .update(claims)
      .set({
        ...(move.subject ? { subjectId: move.subject.id, subjectType: move.subject.type } : {}),
        ...(move.object ? { objectId: move.object.id, objectType: move.object.type } : {}),
        predicate: move.predicate,
        updatedAt: new Date(),
      })
      .where(and(eq(claims.userId, userId), eq(claims.id, move.claimId)))
  }

  await tx
    .update(entities)
    .set({
      nameVariants: [...keep.nameVariants, ...variantsToAdd(keep, drop)],
      // A person confirmed one of these exists; keeping the other name must
      // not undo that. Canon is never lost to a merge, only ever gained.
      ...(drop.canonicity === 'canon' ? { canonicity: 'canon' as const } : {}),
      summary: keep.summary?.trim() ? keep.summary : drop.summary,
      sourceDocumentId: keep.sourceDocumentId ?? drop.sourceDocumentId,
      updatedAt: new Date(),
    })
    .where(and(eq(entities.userId, userId), eq(entities.id, keep.id)))

  // Nothing is left on D to cascade; every claim it had was moved or folded.
  await tx.delete(entities).where(and(eq(entities.userId, userId), eq(entities.id, drop.id)))
}

