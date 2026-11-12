import 'server-only'
import { unstable_cache } from 'next/cache'
import { aliasedTable, and, asc, count, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  claimSources,
  claims,
  documents,
  entities,
  entityTypes,
  predicateSignatures,
  predicates,
} from '@/db/schema'
import { normalizeName } from '@/lib/ontology/matcher'
import { getClaimConflictMarks, type ClaimConflictMark } from './conflicts'

/**
 * Every query here takes userId as its first parameter and filters on it, on
 * the same rule as library.ts: a query without a user scope is the same class
 * of bug as a scope-check bypass.
 *
 * The reference tables (`predicates`, `entity_types`) are global and carry no
 * user column — see the ontology note in src/db/schema.ts — so they join
 * unscoped by design.
 */

/**
 * The ontology — predicates, entity types, signatures — is global reference
 * data. It has no user column, it is written only by `npm run db:seed`, and it
 * is read on every render of the World screen to populate the claim editor's
 * pickers. Re-reading it per navigation was three round trips for bytes that
 * had not changed since the last seed, so the three readers below are cached
 * across requests.
 *
 * The hour is a backstop, not the intended invalidation path. `db:seed` runs as
 * a plain tsx script outside the server, so it cannot call `revalidateTag` —
 * nothing in-process knows the vocabulary moved. A deploy clears the cache
 * anyway (the build id is part of every key), which covers the normal case of
 * seeding and shipping together; the TTL only bounds how long a *running*
 * server can keep serving a vocabulary that was reseeded underneath it.
 *
 * The tag is here so that an in-app writer — a future ontology editor, which is
 * the thing that would make this urgent — can invalidate all three at once.
 *
 * One constraint this buys: `unstable_cache` needs Next's incremental cache in
 * context, so these three are callable only from a request. A plain tsx script
 * that imports them throws "incrementalCache missing"; a script that wants the
 * vocabulary should query the tables directly, as scripts/seed-ontology.ts does.
 */
export const ONTOLOGY_TAG = 'ontology'
const ONTOLOGY_TTL_SECONDS = 60 * 60

const subject = aliasedTable(entities, 'subject')
const object = aliasedTable(entities, 'object')

export type ClaimRow = {
  id: string
  subjectId: string
  subjectName: string
  subjectType: string
  predicate: string
  predicateLabel: string
  predicateKind: string
  inverseName: string | null
  objectId: string | null
  objectName: string | null
  objectType: string | null
  /** Rendered value for an attribute claim; null for a relationship. */
  value: string | null
  valueType: string | null
  startTime: string | null
  endTime: string | null
  canonicity: string
  createdBy: string
  sourceCount: number
  /**
   * The open conflict this claim is part of, if any — a side of a
   * contradiction, or a claim whose sources have all vanished. Derived on
   * read, like the conflicts themselves; see db/queries/conflicts.ts.
   */
  conflict: ClaimConflictMark | null
}

/** The shape both list and detail read, so the two can never disagree. */
const claimSelection = {
  id: claims.id,
  subjectId: claims.subjectId,
  subjectName: subject.name,
  subjectType: claims.subjectType,
  predicate: claims.predicate,
  predicateLabel: predicates.label,
  predicateKind: predicates.kind,
  inverseName: predicates.inverseName,
  objectId: claims.objectId,
  objectName: object.name,
  objectType: claims.objectType,
  /**
   * One rendered string rather than four nullable columns. Exactly one is
   * populated — the schema enforces it — so coalescing loses nothing and saves
   * every caller from re-deriving which column mattered.
   */
  value: sql<string | null>`coalesce(
    ${claims.valueString},
    ${claims.valueTime},
    ${claims.valueInt}::text,
    ${claims.valueFloat}::text
  )`,
  valueType: predicates.valueType,
  startTime: claims.startTime,
  endTime: claims.endTime,
  canonicity: claims.canonicity,
  createdBy: claims.createdBy,
  /**
   * Table names are spelled out rather than interpolated. Drizzle renders an
   * interpolated column *unqualified* inside a raw subquery, so
   * `${claimSources.claimId} = ${claims.id}` becomes `claim_id = id` — and
   * because `claim_sources` has its own `id`, that resolves to the inner table
   * and silently counts zero instead of failing. A wrong number that looks
   * plausible is the worst possible outcome here, so this stays literal.
   */
  sourceCount: sql<number>`(
    select count(*)::int from claim_sources
    where claim_sources.claim_id = claims.id
  )`,
}

function claimsBase(userId: string) {
  return db
    .select(claimSelection)
    .from(claims)
    .innerJoin(subject, eq(subject.id, claims.subjectId))
    .leftJoin(object, eq(object.id, claims.objectId))
    .innerJoin(predicates, eq(predicates.name, claims.predicate))
    .where(eq(claims.userId, userId))
    .$dynamic()
}

export type ClaimFilters = {
  /** Only claims where this entity is the subject or the object. */
  entityId?: string
  /** Matches subject name, object name, or predicate. */
  query?: string
}

export async function getClaims(
  userId: string,
  filters: ClaimFilters = {},
  limit = 500,
): Promise<ClaimRow[]> {
  const conditions = [eq(claims.userId, userId)]

  if (filters.entityId) {
    conditions.push(
      or(eq(claims.subjectId, filters.entityId), eq(claims.objectId, filters.entityId))!,
    )
  }

  if (filters.query) {
    const escaped = filters.query.replace(/([\\%_])/g, '\\$1')
    conditions.push(
      or(
        ilike(subject.name, `%${escaped}%`),
        ilike(object.name, `%${escaped}%`),
        ilike(claims.predicate, `%${escaped}%`),
        ilike(claims.valueString, `%${escaped}%`),
      )!,
    )
  }

  const [rows, marks] = await Promise.all([
    claimsBase(userId)
      .where(and(...conditions))
      .orderBy(asc(subject.name), asc(claims.predicate))
      .limit(limit),
    getClaimConflictMarks(userId),
  ])

  return rows.map((row) => withConflict(row, marks))
}

/**
 * Attaches the conflict mark. Issued alongside the claim read rather than
 * after it, and detection is memoised per request, so on the World screen this
 * shares one pass with the nav rail's count.
 */
function withConflict(
  row: Omit<ClaimRow, 'conflict'>,
  marks: Map<string, ClaimConflictMark>,
): ClaimRow {
  return { ...row, conflict: marks.get(row.id) ?? null }
}

export async function getClaim(userId: string, claimId: string): Promise<ClaimRow | null> {
  const [[row], marks] = await Promise.all([
    claimsBase(userId)
      .where(and(eq(claims.userId, userId), eq(claims.id, claimId)))
      .limit(1),
    getClaimConflictMarks(userId),
  ])

  return row ? withConflict(row, marks) : null
}

export type ClaimSourceRow = {
  id: string
  quote: string | null
  paragraphIndex: number | null
  documentName: string | null
  documentId: string | null
  /** Null when the document has been removed from the Library (decisions §7a). */
  driveFileId: string | null
  removed: boolean
}

export async function getClaimSources(
  userId: string,
  claimId: string,
): Promise<ClaimSourceRow[]> {
  const rows = await db
    .select({
      id: claimSources.id,
      quote: claimSources.quote,
      paragraphIndex: claimSources.paragraphIndex,
      documentName: claimSources.documentName,
      documentId: claimSources.documentId,
      driveFileId: documents.driveFileId,
      removedAt: documents.removedAt,
    })
    .from(claimSources)
    .leftJoin(documents, eq(documents.id, claimSources.documentId))
    .where(and(eq(claimSources.userId, userId), eq(claimSources.claimId, claimId)))
    .orderBy(asc(claimSources.paragraphIndex))

  return rows.map(({ removedAt, ...row }) => ({
    ...row,
    // A vanished source is a first-class state, not a missing row.
    removed: row.documentId === null || removedAt !== null,
  }))
}

/* ---------------------------------------------------------------- entities */

export type EntityRow = {
  id: string
  name: string
  entityType: string
  canonicity: string
  summary: string | null
  nameVariants: string[]
  /** Claims where this entity appears on either side. */
  claimCount: number
}

/** Literal for the same reason as `sourceCount` above — see that comment. */
const claimCountSql = sql<number>`(
  select count(*)::int from claims
  where claims.subject_id = entities.id or claims.object_id = entities.id
)`

export async function getEntities(
  userId: string,
  filters: { type?: string; query?: string } = {},
): Promise<EntityRow[]> {
  const conditions = [eq(entities.userId, userId)]

  if (filters.type) conditions.push(eq(entities.entityType, filters.type))
  if (filters.query) {
    const escaped = filters.query.replace(/([\\%_])/g, '\\$1')
    conditions.push(ilike(entities.name, `%${escaped}%`))
  }

  return db
    .select({
      id: entities.id,
      name: entities.name,
      entityType: entities.entityType,
      canonicity: entities.canonicity,
      summary: entities.summary,
      nameVariants: entities.nameVariants,
      claimCount: claimCountSql,
    })
    .from(entities)
    .where(and(...conditions))
    .orderBy(desc(claimCountSql), asc(entities.name))
}

export async function getEntity(userId: string, entityId: string): Promise<EntityRow | null> {
  const [row] = await db
    .select({
      id: entities.id,
      name: entities.name,
      entityType: entities.entityType,
      canonicity: entities.canonicity,
      summary: entities.summary,
      nameVariants: entities.nameVariants,
      claimCount: claimCountSql,
    })
    .from(entities)
    .where(and(eq(entities.userId, userId), eq(entities.id, entityId)))
    .limit(1)

  return row ?? null
}

export async function getEntityTypeCounts(userId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ entityType: entities.entityType, n: count() })
    .from(entities)
    .where(eq(entities.userId, userId))
    .groupBy(entities.entityType)

  return new Map(rows.map((r) => [r.entityType, r.n]))
}

/* -------------------------------------------------------------- the graph */

export type GraphNode = {
  id: string
  name: string
  entityType: string
  degree: number
}

export type GraphEdge = {
  id: string
  sourceId: string
  targetId: string
  predicate: string
  predicateLabel: string
}

/**
 * An attribute claim, drawn as a leaf hanging off its subject.
 *
 * It has no second entity, so it cannot be an edge between two nodes — but
 * omitting it would mean the graph and the claim table disagreed about how many
 * claims exist, and a picture that quietly drops half your assertions is worse
 * than a slightly busier one. The renderer marks them with a different shape.
 */
export type GraphAttribute = {
  id: string
  subjectId: string
  predicate: string
  predicateLabel: string
  value: string
  valueType: string | null
}

export type Graph = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  attributes: GraphAttribute[]
}

/**
 * The whole graph: every entity, the relationships between them, and the
 * attributes hanging off them.
 *
 * Every entity is a node, including ones nothing has been said about yet. The
 * view's job is to show the world as it stands, and an entity with no claims is
 * a real and interesting state — it is precisely what you have not written up.
 *
 * Both directions of a relationship are stored as separate claims once Phase 2B
 * materialises inverses, and drawing both would double every line. The pair is
 * collapsed here rather than in the renderer so the node degrees are honest.
 */
export async function getGraph(userId: string, limit = 1200): Promise<Graph> {
  /*
   * The three reads are independent, so they are issued together rather than
   * awaited one after another. Over Neon's HTTP driver every query is its own
   * request, so three sequential awaits cost three full round trips — on a
   * dataset this size that was the entire cost of the query, not the work.
   */
  const relationshipRows = db
    .select({
      id: claims.id,
      sourceId: claims.subjectId,
      targetId: claims.objectId,
      predicate: claims.predicate,
      predicateLabel: predicates.label,
      inverseName: predicates.inverseName,
      sourceName: subject.name,
      sourceType: claims.subjectType,
      targetName: object.name,
      targetType: claims.objectType,
    })
    .from(claims)
    .innerJoin(subject, eq(subject.id, claims.subjectId))
    .innerJoin(object, eq(object.id, claims.objectId))
    .innerJoin(predicates, eq(predicates.name, claims.predicate))
    .where(eq(claims.userId, userId))
    .limit(limit)

  const entityRowsPromise = db
    .select({ id: entities.id, name: entities.name, entityType: entities.entityType })
    .from(entities)
    .where(eq(entities.userId, userId))

  const attributeRowsPromise = db
    .select({
      id: claims.id,
      subjectId: claims.subjectId,
      predicate: claims.predicate,
      predicateLabel: predicates.label,
      value: claimSelection.value,
      valueType: predicates.valueType,
    })
    .from(claims)
    .innerJoin(predicates, eq(predicates.name, claims.predicate))
    .where(and(eq(claims.userId, userId), isNull(claims.objectId)))
    .limit(limit)

  const [rows, entityRows, attributeRows] = await Promise.all([
    relationshipRows,
    entityRowsPromise,
    attributeRowsPromise,
  ])

  const nodes = new Map<string, GraphNode>(
    entityRows.map((e) => [e.id, { id: e.id, name: e.name, entityType: e.entityType, degree: 0 }]),
  )
  const edges: GraphEdge[] = []
  const seenPairs = new Set<string>()

  for (const row of rows) {
    if (!row.targetId || !row.targetName || !row.targetType) continue

    // An unordered key, so A—rules→B and B—ruled_by→A collapse to one line.
    const pair = [row.sourceId, row.targetId].sort().join('|')
    const key = `${pair}|${[row.predicate, row.inverseName ?? row.predicate].sort().join('|')}`
    if (seenPairs.has(key)) continue
    seenPairs.add(key)

    // An endpoint outside the entity list would be a dangling foreign key, but
    // skipping rather than inventing a node keeps the invariant "every node is
    // an entity row" true for the renderer.
    const source = nodes.get(row.sourceId)
    const target = nodes.get(row.targetId)
    if (!source || !target) continue
    source.degree++
    target.degree++

    edges.push({
      id: row.id,
      sourceId: row.sourceId,
      targetId: row.targetId,
      predicate: row.predicate,
      predicateLabel: row.predicateLabel,
    })
  }

  const attributes: GraphAttribute[] = []
  for (const row of attributeRows) {
    const subjectNode = nodes.get(row.subjectId)
    if (!subjectNode || row.value === null) continue
    subjectNode.degree++
    attributes.push({
      id: row.id,
      subjectId: row.subjectId,
      predicate: row.predicate,
      predicateLabel: row.predicateLabel,
      value: row.value,
      valueType: row.valueType,
    })
  }

  return { nodes: [...nodes.values()], edges, attributes }
}

/* --------------------------------------------------------------- vocabulary */

export type PredicateOption = {
  name: string
  label: string
  kind: string
  description: string
  inverseName: string | null
  valueType: string | null
  valueEnum: string[] | null
}

/** The vocabulary, for the claim editor's pickers. */
export const getPredicates = unstable_cache(
  async (): Promise<PredicateOption[]> =>
    db
      .select({
        name: predicates.name,
        label: predicates.label,
        kind: predicates.kind,
        description: predicates.description,
        inverseName: predicates.inverseName,
        valueType: predicates.valueType,
        valueEnum: predicates.valueEnum,
      })
      .from(predicates)
      .orderBy(asc(predicates.name)),
  ['ontology', 'predicates'],
  { tags: [ONTOLOGY_TAG], revalidate: ONTOLOGY_TTL_SECONDS },
)

/** Claims whose only source document has left the Library (decisions §7a). */
export async function countUnsourcedClaims(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(claims)
    .innerJoin(claimSources, eq(claimSources.claimId, claims.id))
    .leftJoin(documents, eq(documents.id, claimSources.documentId))
    .where(
      and(
        eq(claims.userId, userId),
        or(isNull(claimSources.documentId), sql`${documents.removedAt} is not null`),
      ),
    )

  return row?.n ?? 0
}

export type EntitySearchHit = {
  id: string
  name: string
  entityType: string
  /** Display form from `entity_types.label`, so the UI never re-derives it. */
  entityTypeLabel: string
  /** Set when the query matched an alias rather than the name. */
  matchedVariant: string | null
}

/**
 * Entity search for the header typeahead.
 *
 * Matches the name, and — via the matcher's normalized key — aliases too, so
 * "Nethros" finds Enua. Variants live in JSONB and would have to be normalised
 * inside SQL to be searchable there, so the alias pass is done in memory over a
 * deliberately small candidate set. See the scale note in matcher.ts.
 */
export async function searchEntities(
  userId: string,
  query: string,
  limit = 8,
): Promise<EntitySearchHit[]> {
  const escaped = query.replace(/([\\%_])/g, '\\$1')

  const rows = await db
    .select({
      id: entities.id,
      name: entities.name,
      entityType: entities.entityType,
      entityTypeLabel: entityTypes.label,
      nameVariants: entities.nameVariants,
      claimCount: claimCountSql,
    })
    .from(entities)
    .innerJoin(entityTypes, eq(entityTypes.name, entities.entityType))
    .where(
      and(
        eq(entities.userId, userId),
        or(
          ilike(entities.name, `%${escaped}%`),
          // Substring match inside the raw JSONB text. Loose on purpose: it only
          // widens the candidate set, and the alias is confirmed below.
          sql`${entities.nameVariants}::text ilike ${`%${escaped}%`}`,
        ),
      ),
    )
    .orderBy(desc(claimCountSql), asc(entities.name))
    .limit(limit)

  const needle = normalizeName(query)

  return rows.map(({ nameVariants, claimCount: _claimCount, ...row }) => {
    const nameHit = normalizeName(row.name).includes(needle)
    const variant = nameHit
      ? null
      : (nameVariants.find((v) => normalizeName(v).includes(needle)) ?? null)
    return { ...row, matchedVariant: variant }
  })
}

export type EntityTypeOption = { name: string; label: string; pluralLabel: string }

/** The type vocabulary, for pickers and for display labels. */
export const getEntityTypes = unstable_cache(
  async (): Promise<EntityTypeOption[]> =>
    db
      .select({
        name: entityTypes.name,
        label: entityTypes.label,
        pluralLabel: entityTypes.pluralLabel,
      })
      .from(entityTypes)
      .orderBy(asc(entityTypes.sortOrder)),
  ['ontology', 'entity-types'],
  { tags: [ONTOLOGY_TAG], revalidate: ONTOLOGY_TTL_SECONDS },
)

export type SignatureRow = {
  predicate: string
  subjectType: string
  /** A real entity type, or '@none' for an attribute signature. */
  objectType: string
}

/**
 * Domain and range, for the claim editor's pickers.
 *
 * Shipped to the client so choosing a subject can narrow the predicate list and
 * choosing a predicate can narrow the object list. ~254 rows of short strings;
 * cheaper than a round trip per keystroke, and it is the same table the
 * signature foreign key checks against, so the picker and the catalog cannot
 * disagree about what is legal.
 */
export const getSignatures = unstable_cache(
  async (): Promise<SignatureRow[]> =>
    db
      .select({
        predicate: predicateSignatures.predicate,
        subjectType: predicateSignatures.subjectType,
        objectType: predicateSignatures.objectType,
      })
      .from(predicateSignatures),
  ['ontology', 'signatures'],
  { tags: [ONTOLOGY_TAG], revalidate: ONTOLOGY_TTL_SECONDS },
)
