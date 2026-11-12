import { aliasedTable, and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { NeonDatabase } from 'drizzle-orm/neon-serverless'
import * as schema from '@/db/schema'
import { claimSources, claims, conflictDismissals, documents, entities, predicates } from '@/db/schema'
import type { ConflictKind } from '@/db/schema'
import {
  conflictId,
  detectValueConflicts,
  findMirrors,
  isValueConflictDismissed,
  pairDirections,
} from './detect'

/**
 * Reading conflicts out of the graph.
 *
 * Takes the database handle rather than importing the app's singleton, on the
 * same pattern as `writeExtraction`: the queries here are tested against a real
 * Postgres (PGlite), and `@/db` is a server-only Neon pool that cannot be built
 * outside Next. `src/db/queries/conflicts.ts` binds this to the real handle.
 *
 * Everything is derived on each read; nothing here writes except the two
 * dismissal functions at the bottom, and a dismissal is the one fact about a
 * conflict that a query over claims cannot reconstruct.
 */

export type Db = NeonDatabase<typeof schema>

/* ------------------------------------------------------------------- shapes */

export type ConflictSource = {
  id: string
  documentId: string | null
  /** The live name if the document is still known, else the snapshot taken at extraction. */
  documentName: string | null
  quote: string | null
  paragraphIndex: number | null
  /** Deleted, trashed, moved out of the root, or hard-gone (ADR §7a). */
  removed: boolean
  webViewLink: string | null
}

export type ConflictClaim = {
  id: string
  subjectId: string
  subjectName: string
  subjectType: string
  predicate: string
  predicateLabel: string
  objectId: string | null
  objectName: string | null
  objectType: string | null
  /** Rendered attribute value; null for a relationship. */
  value: string | null
  valueType: string | null
  startTime: string | null
  endTime: string | null
  canonicity: string
  createdBy: string
  extractedByModel: string | null
  createdAt: string
  sources: ConflictSource[]
}

export type ConflictSide = {
  claims: ConflictClaim[]
  /** Claim ids that "keep this one" deletes. See `DetectedSide.displaces`. */
  displaces: string[]
}

type ConflictBase = {
  /** Short, URL-safe; derived from the key. */
  id: string
  /** What a dismissal stores — see `conflict_dismissals`. */
  key: string
  dismissed: boolean
}

export type ValueConflict = ConflictBase & {
  kind: 'value'
  subject: { id: string; name: string; type: string }
  predicate: {
    name: string
    label: string
    kind: string
    isTemporal: boolean
    valueType: string | null
    valueEnum: string[] | null
  }
  /** For a relationship, the type every side's object shares. */
  objectType: string | null
  sides: ConflictSide[]
  /**
   * The reverse direction of each relationship claim on the sides — `Sera
   * rules Ashfall` for a side holding `Ashfall ruled_by Sera`. Not shown in
   * the inbox, which reads the conflict from its single-valued end; carried so
   * that the World's table, which lists both rows, can mark both.
   */
  mirrorIds: string[]
}

export type VanishedSourceConflict = ConflictBase & {
  kind: 'vanished_source'
  claim: ConflictClaim
  /** The reverse direction, collapsed into this entry. */
  partnerId: string | null
}

export type Conflict = ValueConflict | VanishedSourceConflict

/** Every claim id a conflict is about, its reverse directions included. */
export function claimIdsOf(conflict: Conflict): string[] {
  if (conflict.kind === 'vanished_source') {
    return conflict.partnerId ? [conflict.claim.id, conflict.partnerId] : [conflict.claim.id]
  }
  return [...conflict.sides.flatMap((s) => s.claims.map((c) => c.id)), ...conflict.mirrorIds]
}

/** Every document a conflict's claims cite, removed or not. */
export function documentIdsOf(conflict: Conflict): Set<string> {
  const claimsIn =
    conflict.kind === 'vanished_source' ? [conflict.claim] : conflict.sides.flatMap((s) => s.claims)
  const ids = new Set<string>()
  for (const claim of claimsIn) for (const s of claim.sources) if (s.documentId) ids.add(s.documentId)
  return ids
}

/* ------------------------------------------------------------------ loading */

const subject = aliasedTable(entities, 'subject')
const object = aliasedTable(entities, 'object')

/**
 * Every conflict for a user, open and dismissed, value conflicts first.
 *
 * Three narrow reads rather than one wide one. The candidate filters run in
 * SQL so the rows that reach detection are already few: a value conflict needs
 * two claims on one subject and one single-valued predicate, and a vanished
 * source needs a claim whose every citation is gone. Most of a healthy graph
 * is neither, and never leaves the database.
 */
export async function loadConflicts(db: Db, userId: string): Promise<Conflict[]> {
  const [valueRows, vanishedRows, dismissals] = await Promise.all([
    valueCandidates(db, userId),
    vanishedCandidates(db, userId),
    db
      .select({ kind: conflictDismissals.kind, key: conflictDismissals.key })
      .from(conflictDismissals)
      .where(eq(conflictDismissals.userId, userId)),
  ])

  const detected = detectValueConflicts(valueRows)
  const paired = pairDirections(vanishedRows)

  // Sources only for claims that made it into a conflict.
  const needed = new Set<string>()
  for (const c of detected) for (const s of c.sides) for (const claim of s.claims) needed.add(claim.id)
  for (const { claim } of paired) needed.add(claim.id)
  const [sources, mirrors] = await Promise.all([
    sourcesFor(db, userId, [...needed]),
    mirrorsFor(db, userId, detected.flatMap((c) => c.sides.flatMap((s) => s.claims))),
  ])

  const dismissedValue = dismissals.filter((d) => d.kind === 'value').map((d) => d.key)
  const dismissedVanished = new Set(
    dismissals.filter((d) => d.kind === 'vanished_source').map((d) => d.key),
  )

  const value: ValueConflict[] = detected.map((c) => {
    const first = c.sides[0]!.claims[0]!
    return {
      kind: 'value',
      id: conflictId('value', c.key),
      key: c.key,
      dismissed: isValueConflictDismissed(c.key, dismissedValue),
      subject: { id: first.subjectId, name: first.subjectName, type: first.subjectType },
      predicate: {
        name: first.predicate,
        label: first.predicateLabel,
        kind: first.predicateKind,
        isTemporal: first.isTemporal,
        valueType: first.valueType,
        valueEnum: first.valueEnum,
      },
      objectType: c.objectType,
      sides: c.sides.map((s) => ({
        claims: s.claims.map((row) => toConflictClaim(row, sources)),
        displaces: s.displaces,
      })),
      mirrorIds: c.sides.flatMap((s) =>
        s.claims.flatMap((claim) => {
          const mirror = mirrors.get(claim.id)
          return mirror ? [mirror] : []
        }),
      ),
    }
  })

  const vanished: VanishedSourceConflict[] = paired.map(({ claim, partnerId }) => ({
    kind: 'vanished_source',
    // The claim shown is the key. Either direction's id matches a dismissal,
    // so the pairing choosing the other one later cannot re-open it.
    id: conflictId('vanished_source', claim.id),
    key: claim.id,
    dismissed:
      dismissedVanished.has(claim.id) || (partnerId !== null && dismissedVanished.has(partnerId)),
    claim: toConflictClaim(claim, sources),
    partnerId,
  }))

  return [...value, ...vanished]
}

/** The columns both candidate queries read, so both build the same claim. */
const candidateSelection = {
  id: claims.id,
  subjectId: claims.subjectId,
  subjectName: subject.name,
  subjectType: claims.subjectType,
  predicate: claims.predicate,
  predicateLabel: predicates.label,
  predicateKind: predicates.kind,
  inverseName: predicates.inverseName,
  isTemporal: predicates.isTemporal,
  valueType: predicates.valueType,
  valueEnum: predicates.valueEnum,
  objectId: claims.objectId,
  objectName: object.name,
  objectType: claims.objectType,
  valueString: claims.valueString,
  valueInt: claims.valueInt,
  valueFloat: claims.valueFloat,
  valueTime: claims.valueTime,
  valueOrder: claims.valueOrder,
  startTime: claims.startTime,
  startOrder: claims.startOrder,
  endTime: claims.endTime,
  endOrder: claims.endOrder,
  canonicity: claims.canonicity,
  createdBy: claims.createdBy,
  extractedByModel: claims.extractedByModel,
  createdAt: claims.createdAt,
}

/** One row of `candidateSelection`. Spelled out because the loaders below are typed by it. */
type CandidateRow = {
  id: string
  subjectId: string
  subjectName: string
  subjectType: string
  predicate: string
  predicateLabel: string
  predicateKind: string
  inverseName: string | null
  isTemporal: boolean
  valueType: string | null
  valueEnum: string[] | null
  objectId: string | null
  objectName: string | null
  objectType: string | null
  valueString: string | null
  valueInt: number | null
  valueFloat: number | null
  valueTime: string | null
  valueOrder: number | null
  startTime: string | null
  startOrder: number | null
  endTime: string | null
  endOrder: number | null
  canonicity: string
  createdBy: string
  extractedByModel: string | null
  createdAt: Date
}

function candidates(db: Db) {
  return db
    .select(candidateSelection)
    .from(claims)
    .innerJoin(predicates, eq(predicates.name, claims.predicate))
    .innerJoin(subject, eq(subject.id, claims.subjectId))
    .leftJoin(object, eq(object.id, claims.objectId))
    .$dynamic()
}

/**
 * Claims on a single-valued predicate whose subject has at least one other
 * claim on it. Detection decides whether they disagree; this only rules out
 * the ones that cannot.
 *
 * Table names inside the raw subquery are literal, not interpolated — see the
 * note on `sourceCount` in db/queries/claims.ts for the silent miscount that
 * interpolation produces there.
 */
function valueCandidates(db: Db, userId: string): Promise<CandidateRow[]> {
  return candidates(db)
    .where(
      and(
        eq(claims.userId, userId),
        eq(predicates.isFunctional, true),
        sql`exists (
          select 1 from claims sibling
          where sibling.user_id = claims.user_id
            and sibling.subject_id = claims.subject_id
            and sibling.predicate = claims.predicate
            and sibling.id <> claims.id
        )`,
      ),
    )
    .orderBy(asc(claims.createdAt), asc(claims.id))
}

/**
 * Claims that cite at least one document and whose every citation is gone.
 *
 * A claim with no `claim_sources` at all was entered by hand and is complete
 * as it stands (ADR §7a applies only to claims that cited something), so the
 * inner join is load-bearing. "Gone" is `removed_at` set — which every path
 * that removes a document sets, trash included — or `trashed` for safety, or
 * the document row deleted outright and the FK nulled.
 *
 * Nothing records *that* a claim is flagged: a document that comes back clears
 * `removed_at`, and the claim drops out of this query on the next read.
 */
function vanishedCandidates(db: Db, userId: string): Promise<CandidateRow[]> {
  return candidates(db)
    .where(
      and(
        eq(claims.userId, userId),
        sql`claims.id in (
          select cs.claim_id
          from claim_sources cs
          left join documents d on d.id = cs.document_id
          where cs.user_id = ${userId}
          group by cs.claim_id
          having bool_and(cs.document_id is null or d.removed_at is not null or d.trashed)
        )`,
      ),
    )
    .orderBy(asc(claims.createdAt), asc(claims.id))
}

/**
 * The reverse directions of the relationship claims in value conflicts — see
 * `ValueConflict.mirrorIds`. One read narrowed by ends and predicate in SQL;
 * the exact match, dates included, is `findMirrors`.
 */
async function mirrorsFor(
  db: Db,
  userId: string,
  conflicted: CandidateRow[],
): Promise<Map<string, string>> {
  const relationships = conflicted.filter((c) => c.objectId !== null && c.inverseName !== null)
  if (relationships.length === 0) return new Map()

  const pool = await db
    .select({
      id: claims.id,
      subjectId: claims.subjectId,
      objectId: claims.objectId,
      predicate: claims.predicate,
      startTime: claims.startTime,
      endTime: claims.endTime,
    })
    .from(claims)
    .where(
      and(
        eq(claims.userId, userId),
        inArray(claims.subjectId, [...new Set(relationships.map((c) => c.objectId!))]),
        inArray(claims.objectId, [...new Set(relationships.map((c) => c.subjectId))]),
        inArray(claims.predicate, [...new Set(relationships.map((c) => c.inverseName!))]),
      ),
    )

  return findMirrors(relationships, pool)
}

async function sourcesFor(db: Db, userId: string, claimIds: string[]) {
  const byClaim = new Map<string, ConflictSource[]>()
  if (claimIds.length === 0) return byClaim

  const rows = await db
    .select({
      id: claimSources.id,
      claimId: claimSources.claimId,
      documentId: claimSources.documentId,
      snapshotName: claimSources.documentName,
      liveName: documents.name,
      quote: claimSources.quote,
      paragraphIndex: claimSources.paragraphIndex,
      removedAt: documents.removedAt,
      trashed: documents.trashed,
      webViewLink: documents.webViewLink,
    })
    .from(claimSources)
    .leftJoin(documents, eq(documents.id, claimSources.documentId))
    .where(and(eq(claimSources.userId, userId), inArray(claimSources.claimId, claimIds)))
    .orderBy(asc(claimSources.documentName), asc(claimSources.paragraphIndex))

  for (const row of rows) {
    const removed = row.documentId === null || row.removedAt !== null || row.trashed === true
    const source: ConflictSource = {
      id: row.id,
      documentId: row.documentId,
      documentName: row.liveName ?? row.snapshotName,
      quote: row.quote,
      paragraphIndex: row.paragraphIndex,
      removed,
      // A link to a document that is no longer in the Library would open
      // something the user deliberately took out of it.
      webViewLink: removed ? null : row.webViewLink,
    }
    const list = byClaim.get(row.claimId)
    if (list) list.push(source)
    else byClaim.set(row.claimId, [source])
  }
  return byClaim
}

function toConflictClaim(row: CandidateRow, sources: Map<string, ConflictSource[]>): ConflictClaim {
  return {
    id: row.id,
    subjectId: row.subjectId,
    subjectName: row.subjectName,
    subjectType: row.subjectType,
    predicate: row.predicate,
    predicateLabel: row.predicateLabel,
    objectId: row.objectId,
    objectName: row.objectName,
    objectType: row.objectType,
    value:
      row.valueString ??
      row.valueTime ??
      (row.valueInt !== null ? String(row.valueInt) : null) ??
      (row.valueFloat !== null ? String(row.valueFloat) : null),
    valueType: row.valueType,
    startTime: row.startTime,
    endTime: row.endTime,
    canonicity: row.canonicity,
    createdBy: row.createdBy,
    extractedByModel: row.extractedByModel,
    createdAt: row.createdAt.toISOString(),
    sources: sources.get(row.id) ?? [],
  }
}

/* --------------------------------------------------------------- dismissals */

/**
 * "I know — leave it." Idempotent: dismissing twice is one row, by the
 * `(user_id, kind, key)` unique index.
 */
export async function dismissConflict(db: Db, userId: string, kind: ConflictKind, key: string) {
  await db.insert(conflictDismissals).values({ userId, kind, key }).onConflictDoNothing()
}

/**
 * Undoes a dismissal, taking the conflict as it reads now.
 *
 * For a value conflict, every stored dismissal that covers the current claims
 * goes — the one hiding it may have been made over a larger set (see
 * `isValueConflictDismissed`), and leaving that in place would make "reopen"
 * a button that does nothing. For a vanished source, either direction's id may
 * be the one that was stored.
 */
export async function restoreConflict(
  db: Db,
  userId: string,
  conflict: Pick<Conflict, 'kind' | 'key'> & { partnerId?: string | null },
) {
  const rows = await db
    .select({ id: conflictDismissals.id, key: conflictDismissals.key })
    .from(conflictDismissals)
    .where(and(eq(conflictDismissals.userId, userId), eq(conflictDismissals.kind, conflict.kind)))

  const covering = rows.filter((row) =>
    conflict.kind === 'value'
      ? isValueConflictDismissed(conflict.key, [row.key])
      : row.key === conflict.key || row.key === conflict.partnerId,
  )
  if (covering.length === 0) return

  await db.delete(conflictDismissals).where(
    and(
      eq(conflictDismissals.userId, userId),
      inArray(
        conflictDismissals.id,
        covering.map((row) => row.id),
      ),
    ),
  )
}
