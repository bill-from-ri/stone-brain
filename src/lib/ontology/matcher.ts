import { eq } from 'drizzle-orm'
import type { NeonDatabase } from 'drizzle-orm/neon-serverless'
import type * as schema from '@/db/schema'
import { type Canonicity, entities } from '@/db/schema'
import { normalizeName } from './name-key'

/**
 * Resolving a surface string to an entity that already exists.
 *
 * ## The matcher writes nothing
 *
 * Not a limitation — the definition. It answers *matched*, *ambiguous*, or
 * *none*, and never creates, merges, renames, or promotes. Two consequences
 * that are the whole point:
 *
 *   - A name it cannot resolve is **not** quietly turned into a new draft
 *     entity. Minting entities for unrecognised names is how a bad extraction
 *     fills a world with junk; deciding to create one is Phase 2B's proposal
 *     step, which decides deliberately and records why.
 *   - A near miss is **never** returned as a match. `entities.normalized_name`
 *     is deliberately not unique (ADR §15), so two distinct entities may share
 *     a name, and silently picking one destroys information that nothing
 *     downstream would ever surface. Ambiguity is reported, not resolved.
 *
 * Suggestions exist for the caller's benefit — a "did you mean" in the UI, or a
 * warning at the proposal step that a similar entity already exists — and are
 * kept strictly separate from matches.
 *
 * ## Scale
 *
 * `loadEntityIndex()` reads every entity the user owns and matches in memory.
 * That is deliberate: variants live in a JSONB array and would have to be
 * normalised inside SQL to be searchable, which is worse than it sounds. At
 * this size the whole set is tens of kilobytes and one query beats one query
 * per name. If a world ever outgrows it, the fix is a `normalized_variants`
 * column with a trigram index — a change to this file and a migration, not to
 * any caller.
 */

export type EntityRef = {
  id: string
  name: string
  entityType: string
  canonicity: Canonicity
  /** Whether the string matched the entity's name or one of its aliases. */
  via: 'name' | 'variant'
}

export type Suggestion = EntityRef & {
  reason:
    /** Spelled almost the same. */
    | 'near_miss'
    /** Exactly this name, but not the type that was asked for. */
    | 'other_type'
}

export type MatchResult =
  | { status: 'matched'; entity: EntityRef }
  | { status: 'ambiguous'; candidates: EntityRef[] }
  | { status: 'none'; suggestions: Suggestion[] }

/* --------------------------------------------------------------- normalising */

/**
 * Re-exported, not defined here: it moved to ./name-key so that a client
 * component can import it without dragging this file's drizzle and schema
 * imports into the browser bundle. Every existing caller still reads it from
 * the matcher, which is where it belongs conceptually.
 */
export { normalizeName } from './name-key'

/**
 * The article-stripped key, used only as a fallback after the strict key
 * misses. Defined in ./name-key beside `normalizeName`; re-exported here
 * because this is where callers look for name comparison.
 */
export { looseNameKey } from './name-key'

/** Already-normalised in, article-stripped out — the map keys are built this way. */
const looseKey = (normalized: string) => normalized.replace(/^(the|a|an) /, '')

/* ------------------------------------------------------------------ the index */

type IndexRow = {
  id: string
  name: string
  entityType: string
  canonicity: Canonicity
  normalizedName: string
  nameVariants: string[]
}

export type EntityIndex = {
  /** Strict normalized key → the entities reachable by it. */
  strict: Map<string, EntityRef[]>
  /** Article-stripped key → the same. */
  loose: Map<string, EntityRef[]>
  /** Every (key, entity) pair, for edit-distance suggestions. */
  all: { key: string; ref: EntityRef }[]
}

export function buildEntityIndex(rows: IndexRow[]): EntityIndex {
  const strict = new Map<string, EntityRef[]>()
  const loose = new Map<string, EntityRef[]>()
  const all: { key: string; ref: EntityRef }[] = []

  const add = (map: Map<string, EntityRef[]>, key: string, ref: EntityRef) => {
    if (!key) return
    const bucket = map.get(key)
    if (bucket) {
      // A variant equal to the entity's own name must not list it twice.
      if (!bucket.some((r) => r.id === ref.id && r.via === ref.via)) bucket.push(ref)
    } else {
      map.set(key, [ref])
    }
  }

  for (const row of rows) {
    const base = { id: row.id, name: row.name, entityType: row.entityType, canonicity: row.canonicity }

    const keys: { key: string; via: EntityRef['via'] }[] = [
      { key: row.normalizedName || normalizeName(row.name), via: 'name' },
      ...row.nameVariants.map((v) => ({ key: normalizeName(v), via: 'variant' as const })),
    ]

    for (const { key, via } of keys) {
      const ref: EntityRef = { ...base, via }
      add(strict, key, ref)
      add(loose, looseKey(key), ref)
      all.push({ key, ref })
    }
  }

  return { strict, loose, all }
}

export async function loadEntityIndex(
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

/* -------------------------------------------------------------- the resolution */

export type ResolveOptions = {
  /**
   * Optional, per the matcher's contract. Supply it when the caller knows —
   * extraction always does, a user typing into a form may not. Without it a
   * name that resolves to exactly one entity still resolves; a name shared
   * across types comes back ambiguous instead of being guessed at.
   */
  type?: string
  /** How many near misses to offer when nothing matched. */
  suggestionLimit?: number
}

export function resolve(index: EntityIndex, name: string, options: ResolveOptions = {}): MatchResult {
  const { type, suggestionLimit = 3 } = options
  const key = normalizeName(name)

  if (!key) return { status: 'none', suggestions: [] }

  const exact = index.strict.get(key) ?? []
  const hits = exact.length > 0 ? exact : (index.loose.get(looseKey(key)) ?? [])

  const typed = type ? hits.filter((r) => r.entityType === type) : hits

  // Distinct entities, not distinct keys: an entity reachable by both its name
  // and one of its variants is still one entity.
  const distinct = dedupeById(typed)

  if (distinct.length === 1) return { status: 'matched', entity: distinct[0]! }
  if (distinct.length > 1) return { status: 'ambiguous', candidates: distinct }

  /**
   * Nothing matched. If the name exists under another type, say so — that is
   * far more useful than a spelling suggestion, and usually means the caller
   * typed the wrong type rather than the wrong name.
   */
  const suggestions: Suggestion[] = dedupeById(hits).map((ref) => ({ ...ref, reason: 'other_type' }))

  for (const ref of nearest(index, key, suggestionLimit)) {
    if (type && ref.entityType !== type) continue
    if (suggestions.some((s) => s.id === ref.id)) continue
    suggestions.push({ ...ref, reason: 'near_miss' })
  }

  return { status: 'none', suggestions: suggestions.slice(0, suggestionLimit) }
}

/** Convenience for a single lookup; prefer loading the index once for a batch. */
export async function resolveEntity(
  db: NeonDatabase<typeof schema>,
  userId: string,
  name: string,
  options: ResolveOptions = {},
): Promise<MatchResult> {
  return resolve(await loadEntityIndex(db, userId), name, options)
}

function dedupeById(refs: EntityRef[]): EntityRef[] {
  const seen = new Map<string, EntityRef>()
  for (const ref of refs) {
    // Prefer the name reading over a variant reading of the same entity.
    const existing = seen.get(ref.id)
    if (!existing || (existing.via === 'variant' && ref.via === 'name')) seen.set(ref.id, ref)
  }
  return [...seen.values()]
}

/**
 * Near misses by edit distance, thresholded.
 *
 * Same rule as the extraction layer's predicate suggestions: below the
 * threshold it offers nothing rather than reaching for a distant name. A
 * suggestion that is only nearest by spelling invites the exact wrong merge.
 */
function nearest(index: EntityIndex, key: string, limit: number): EntityRef[] {
  const threshold = Math.max(1, Math.floor(key.length / 4))

  return index.all
    .map(({ key: candidate, ref }) => ({ ref, d: distance(key, candidate) }))
    .filter((c) => c.d > 0 && c.d <= threshold)
    .sort((a, b) => a.d - b.d || a.ref.name.localeCompare(b.ref.name))
    .slice(0, limit)
    .map((c) => c.ref)
}

function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 8) return Number.POSITIVE_INFINITY
  const rows = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let previous = rows[0]!
    rows[0] = i
    for (let j = 1; j <= b.length; j++) {
      const current = rows[j]!
      rows[j] = Math.min(rows[j]! + 1, rows[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1))
      previous = current
    }
  }
  return rows[b.length]!
}
