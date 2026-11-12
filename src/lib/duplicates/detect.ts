import type { DuplicateReason, DuplicateReasonCode } from './types'
import {
  genericDifference,
  genericKey,
  isVariantOf,
  pluralKey,
  pluralPair,
  sameWordsReordered,
  titleDifference,
  titleKey,
  wordSetKey,
} from './names'
import { looseNameKey } from '@/lib/ontology/name-key'

/**
 * Duplicate detection, as pure functions over entity rows.
 *
 * Like value conflicts (src/lib/conflicts/detect.ts), possible duplicates are
 * derived on every read and never stored; only a "not the same" dismissal is.
 * This module is handed the user's entities and says which pairs look like one
 * thing under two names, why, and which of the two should probably survive.
 * The database is the caller's business, which is what lets the rules be
 * tested name by name.
 *
 * Three rules shape what is *not* reported, and each is there because a
 * suggestion the person has to wave away costs them more than a missed one:
 *
 *   - **At least one side is a draft.** Two canon entities were each confirmed
 *     by a person; suggesting they are one thing second-guesses both.
 *   - **Fuzzy rules need one type.** A plural, a title or a generic word is
 *     enough to match `Interior Basin` with the region `Interior`, but across
 *     types the same rules match `House Lanzhelm` the family with `Lanzhelm`
 *     the town. Only the exact-word rules — a recorded variant, the same words
 *     reordered — may pair entities of different types.
 *   - **Identical names across types are not duplicates.** The schema allows a
 *     faction and a settlement to share a name on purpose.
 */

/** What detection needs to know about an entity. Callers may carry more. */
export type DetectableEntity = {
  id: string
  name: string
  entityType: string
  nameVariants: readonly string[]
  canonicity: string
  createdBy: string
  claimCount: number
  createdAt: Date
}

/** A relationship claim's two ends: all that "shared neighbour" needs. */
export type Edge = { subjectId: string; objectId: string }

export type DetectedDuplicate<T> = {
  /** The two ids, sorted, joined with `|`: the dismissal key. */
  key: string
  /** The suggested survivor first — see `survivorFirst`. */
  entities: [T, T]
  reasons: DuplicateReason[]
  /** Ids of entities a relationship connects to both. Filled by `rankDuplicates`. */
  sharedNeighbourIds: string[]
  crossType: boolean
}

/** The dismissal key for a pair: order-free, so either way round is one pair. */
export function duplicateKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/**
 * How much each reason says. A recorded variant is a person or extractor
 * having already said "this is another name for that"; a generic word is the
 * weakest, since `X Basin` beside `X` is sometimes a basin and its river.
 */
const STRENGTH: Record<DuplicateReasonCode, number> = {
  variant: 3,
  title: 2,
  plural: 2,
  word_order: 2,
  generic_word: 1,
}

/** The rules that may pair two entities of different types. */
const CROSS_TYPE: ReadonlySet<DuplicateReasonCode> = new Set(['variant', 'word_order'])

const quote = (name: string) => `“${name}”`

/**
 * Every reason `a` and `b` look like one entity, in a fixed order. Empty when
 * none hold — including when they hold only by a rule their types forbid.
 */
export function reasonsFor(a: DetectableEntity, b: DetectableEntity): DuplicateReason[] {
  const sameType = a.entityType === b.entityType
  const reasons: DuplicateReason[] = []

  const sameName = looseNameKey(a.name) === looseNameKey(b.name)
  if (sameName) {
    // Two of one type under one name is the plainest duplicate there is; two
    // types under one name is the schema working as intended.
    if (sameType) reasons.push({ code: 'variant', text: `Both are named ${quote(a.name)}.` })
  } else if (isVariantOf(a.name, b.nameVariants)) {
    reasons.push({ code: 'variant', text: `${quote(a.name)} is recorded as another name for ${quote(b.name)}.` })
  } else if (isVariantOf(b.name, a.nameVariants)) {
    reasons.push({ code: 'variant', text: `${quote(b.name)} is recorded as another name for ${quote(a.name)}.` })
  }

  if (sameWordsReordered(a.name, b.name)) {
    reasons.push({
      code: 'word_order',
      text: `${quote(a.name)} and ${quote(b.name)} have the same words in a different order.`,
    })
  }

  if (sameType && !sameName) {
    if (pluralPair(a.name, b.name)) {
      reasons.push({ code: 'plural', text: `${quote(a.name)} and ${quote(b.name)} differ only by a plural.` })
    }

    const title = titleDifference(a.name, b.name)
    if (title) {
      const [titled, bare] = title.titled === 'a' ? [a, b] : [b, a]
      const words = title.titles.join(' ')
      reasons.push({
        code: 'title',
        text: `${quote(titled.name)} is ${quote(bare.name)} with the title ${quote(words)}.`,
      })
    }

    const generic = genericDifference(a.name, b.name)
    if (generic) {
      const [extended, bare] = generic.extended === 'a' ? [a, b] : [b, a]
      const words = generic.words.join(' ')
      reasons.push({
        code: 'generic_word',
        text: `${quote(extended.name)} is ${quote(bare.name)} with ${quote(words)} added.`,
      })
    }
  }

  return sameType ? reasons : reasons.filter((r) => CROSS_TYPE.has(r.code))
}

const PROVENANCE_RANK: Record<string, number> = { seed: 0, user: 0, llm: 1 }

/**
 * Which of two entities a merge should probably keep: canon before draft (a
 * person confirmed it), hand-made before extracted, then the one more of the
 * graph already hangs on, then the elder. Negative when `a` should survive.
 */
export function compareSurvivor(a: DetectableEntity, b: DetectableEntity): number {
  const canon = Number(b.canonicity === 'canon') - Number(a.canonicity === 'canon')
  if (canon !== 0) return canon
  const made = (PROVENANCE_RANK[a.createdBy] ?? 1) - (PROVENANCE_RANK[b.createdBy] ?? 1)
  if (made !== 0) return made
  if (a.claimCount !== b.claimCount) return b.claimCount - a.claimCount
  const age = a.createdAt.getTime() - b.createdAt.getTime()
  if (age !== 0) return age
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Every pair of entities that looks like one, survivor first, unranked and
 * without neighbours.
 *
 * Entities are bucketed by each rule's key (names.ts) rather than compared
 * all against all; a pair sharing any key is then put through `reasonsFor`,
 * which is the actual test. Variants are bucketed under the same key as names,
 * so `giants` with the variant `Giant` meets the entity named `Giant`.
 */
export function findDuplicatePairs<T extends DetectableEntity>(entities: readonly T[]): DetectedDuplicate<T>[] {
  const buckets = new Map<string, T[]>()
  const put = (key: string, entity: T) => {
    if (key === '' || key.endsWith(':')) return
    const bucket = buckets.get(key)
    if (bucket) {
      if (bucket[bucket.length - 1] !== entity) bucket.push(entity)
    } else buckets.set(key, [entity])
  }

  for (const e of entities) {
    put(`name:${looseNameKey(e.name)}`, e)
    for (const v of e.nameVariants) put(`name:${looseNameKey(v)}`, e)
    put(`order:${wordSetKey(e.name)}`, e)
    // The fuzzy keys carry the type, since their rules never cross one.
    put(`plural:${e.entityType}:${pluralKey(e.name)}`, e)
    put(`title:${e.entityType}:${titleKey(e.name)}`, e)
    put(`generic:${e.entityType}:${genericKey(e.name)}`, e)
  }

  const seen = new Set<string>()
  const found: DetectedDuplicate<T>[] = []
  for (const bucket of buckets.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i]!
        const b = bucket[j]!
        if (a.id === b.id) continue
        const key = duplicateKey(a.id, b.id)
        if (seen.has(key)) continue
        seen.add(key)

        if (a.canonicity !== 'draft' && b.canonicity !== 'draft') continue
        const reasons = reasonsFor(a, b)
        if (reasons.length === 0) continue

        found.push({
          key,
          entities: compareSurvivor(a, b) <= 0 ? [a, b] : [b, a],
          reasons,
          sharedNeighbourIds: [],
          crossType: a.entityType !== b.entityType,
        })
      }
    }
  }
  return found
}

/**
 * Fills in shared neighbours and orders the pairs: stronger reasons first,
 * then more shared neighbours — a pair both `located_in` the same province is
 * more than a coincidence of names — then by the survivor's name.
 *
 * `edges` need only cover the entities in `pairs`; either direction of a
 * relationship will do, and both are fine.
 */
export function rankDuplicates<T extends DetectableEntity>(
  pairs: readonly DetectedDuplicate<T>[],
  edges: readonly Edge[],
): DetectedDuplicate<T>[] {
  const neighbours = new Map<string, Set<string>>()
  const link = (from: string, to: string) => {
    const set = neighbours.get(from)
    if (set) set.add(to)
    else neighbours.set(from, new Set([to]))
  }
  for (const e of edges) {
    link(e.subjectId, e.objectId)
    link(e.objectId, e.subjectId)
  }

  const ranked = pairs.map((pair) => {
    const [a, b] = pair.entities
    const na = neighbours.get(a.id) ?? new Set<string>()
    const nb = neighbours.get(b.id) ?? new Set<string>()
    const shared = [...na].filter((id) => nb.has(id) && id !== a.id && id !== b.id).sort()
    return { ...pair, sharedNeighbourIds: shared }
  })

  const strength = (p: DetectedDuplicate<T>) => p.reasons.reduce((sum, r) => sum + STRENGTH[r.code], 0)
  return ranked.sort(
    (x, y) =>
      strength(y) - strength(x) ||
      y.sharedNeighbourIds.length - x.sharedNeighbourIds.length ||
      x.entities[0].name.localeCompare(y.entities[0].name) ||
      (x.key < y.key ? -1 : x.key > y.key ? 1 : 0),
  )
}

/** `findDuplicatePairs` then `rankDuplicates`, for a caller that has every edge to hand. */
export function detectDuplicates<T extends DetectableEntity>(
  entities: readonly T[],
  edges: readonly Edge[],
): DetectedDuplicate<T>[] {
  return rankDuplicates(findDuplicatePairs(entities), edges)
}
