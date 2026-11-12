import { createHash } from 'node:crypto'
import type { ConflictKind } from '@/db/schema'
import { RELATIONSHIPS } from '@/lib/ontology/registry'
import { periodOf, periodsConflict, type PeriodColumns } from './period'
import { sameValue, type ValueColumns } from './values'

/**
 * Conflict detection, as pure functions over claim rows.
 *
 * Conflicts are derived, never stored (see `conflict_dismissals` in
 * src/db/schema.ts): this module is handed the candidate claims and says which
 * of them disagree. Keeping it free of the database is what lets the edge cases
 * — and there are many — be tested exhaustively without one.
 */

/** What detection needs to know about a claim. Callers may carry more. */
export type DetectableClaim = PeriodColumns &
  ValueColumns & {
    id: string
    subjectId: string
    predicate: string
    /** Null for an attribute claim. */
    objectType: string | null
    /** From the predicate. A non-temporal predicate ignores dates. */
    isTemporal: boolean
  }

export type DetectedSide<T> = {
  /** Every claim giving this side's answer. Usually one; more when it is restated with other dates. */
  claims: T[]
  /**
   * The claims "keep this one" would delete: those on other sides that
   * actually conflict with a claim on this one.
   *
   * Not simply "every other side". In a chain — A overlaps B, B overlaps C,
   * A and C are a clean succession — the three are one conflict, because B is
   * contested by both. Keeping A should remove B and leave C, which never
   * disagreed with A at all.
   */
  displaces: string[]
}

export type DetectedValueConflict<T> = {
  /** The dismissal key: see `valueConflictKey`. */
  key: string
  subjectId: string
  predicate: string
  objectType: string | null
  sides: DetectedSide<T>[]
}

/**
 * Finds every value conflict among `claims`.
 *
 * The caller passes only claims on single-valued predicates. Claims are
 * grouped by subject, predicate and — for relationships — object type, and
 * within a group two claims *disagree* when their values differ and their
 * periods do not keep them apart (period.ts). A conflict is a connected set of
 * disagreements: N rulers contesting one city is one conflict with N sides,
 * not N·(N−1)/2 pairwise ones.
 *
 * Why the object type is part of the group: different types are different
 * scales, not different answers. A town `ruled_by` its duke and `ruled_by` the
 * duchy is layered sovereignty, and `born_in` a city and `born_in` its region
 * is one birth described twice. Comparing them would make the commonest
 * honest phrasing in the corpus read as a contradiction.
 *
 * Input order is preserved in the output — sides in the order their first
 * claim appears — so a caller that sorts claims by age gets the oldest answer
 * first.
 */
export function detectValueConflicts<T extends DetectableClaim>(
  claims: readonly T[],
): DetectedValueConflict<T>[] {
  const groups = new Map<string, T[]>()
  for (const claim of claims) {
    const key = `${claim.subjectId}|${claim.predicate}|${claim.objectType ?? ''}`
    const group = groups.get(key)
    if (group) group.push(claim)
    else groups.set(key, [claim])
  }

  const found: DetectedValueConflict<T>[] = []
  for (const group of groups.values()) {
    if (group.length < 2) continue
    found.push(...conflictsInGroup(group))
  }
  return found
}

function conflictsInGroup<T extends DetectableClaim>(group: T[]): DetectedValueConflict<T>[] {
  const periods = group.map(periodOf)
  const disagrees = group.map(() => new Set<number>())

  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      const a = group[i]!
      const b = group[j]!
      if (sameValue(a, b)) continue
      if (!periodsConflict(periods[i]!, periods[j]!, a.isTemporal)) continue
      disagrees[i]!.add(j)
      disagrees[j]!.add(i)
    }
  }

  const result: DetectedValueConflict<T>[] = []
  const visited = new Set<number>()

  for (let start = 0; start < group.length; start++) {
    if (visited.has(start) || disagrees[start]!.size === 0) continue

    // Connected component by depth-first walk; small, so no union-find.
    const members: number[] = []
    const stack = [start]
    visited.add(start)
    while (stack.length) {
      const i = stack.pop()!
      members.push(i)
      for (const j of disagrees[i]!) {
        if (!visited.has(j)) {
          visited.add(j)
          stack.push(j)
        }
      }
    }
    members.sort((x, y) => x - y)

    // Claims that agree are one side. Agreement on dates is not transitive in
    // principle (a year agrees with two different months inside it), so each
    // claim joins the first side whose first claim it agrees with.
    const sides: number[][] = []
    for (const i of members) {
      const side = sides.find((s) => sameValue(group[s[0]!]!, group[i]!))
      if (side) side.push(i)
      else sides.push([i])
    }

    const first = group[members[0]!]!
    result.push({
      key: valueConflictKey(
        first.subjectId,
        first.predicate,
        members.map((i) => group[i]!.id),
      ),
      subjectId: first.subjectId,
      predicate: first.predicate,
      objectType: first.objectType,
      sides: sides.map((side) => {
        const inSide = new Set(side)
        const displaced = new Set<number>()
        for (const i of side) for (const j of disagrees[i]!) if (!inSide.has(j)) displaced.add(j)
        return {
          claims: side.map((i) => group[i]!),
          displaces: [...displaced].sort((x, y) => x - y).map((j) => group[j]!.id),
        }
      }),
    })
  }

  return result
}

/* --------------------------------------------------------------- dismissals */

/**
 * `subject|predicate|claim,claim,…`, claim ids sorted.
 *
 * The schema's contract for `conflict_dismissals.key`: it names the exact set
 * of claims that disagreed when the user said "leave it", so that a new claim
 * joining the argument re-opens it.
 */
export function valueConflictKey(subjectId: string, predicate: string, claimIds: string[]): string {
  return `${subjectId}|${predicate}|${[...claimIds].sort().join(',')}`
}

function parseValueKey(key: string): { scope: string; claimIds: string[] } | null {
  const cut = key.lastIndexOf('|')
  if (cut < 0) return null
  return { scope: key.slice(0, cut), claimIds: key.slice(cut + 1).split(',').filter(Boolean) }
}

/**
 * Whether a value conflict is covered by one of the user's dismissals.
 *
 * Covered means a dismissal for the same subject and predicate whose claims
 * include *every* claim in the conflict now — a superset, not an exact match.
 * The difference matters on the way down: after a dismissed three-way conflict
 * loses a side to deletion, what remains is two claims the user already looked
 * at and accepted, and re-raising them would be asking the same question
 * twice. On the way up the rule is the one the schema promises: a claim the
 * user has never seen is not in the dismissed set, so its arrival re-opens it.
 */
export function isValueConflictDismissed(key: string, dismissedKeys: Iterable<string>): boolean {
  const current = parseValueKey(key)
  if (!current) return false
  for (const dismissed of dismissedKeys) {
    const parsed = parseValueKey(dismissed)
    if (!parsed || parsed.scope !== current.scope) continue
    const accepted = new Set(parsed.claimIds)
    if (current.claimIds.every((id) => accepted.has(id))) return true
  }
  return false
}

/**
 * A short, stable handle for URLs — the key itself is a list of UUIDs. A hash
 * of the dismissal key, so it changes exactly when the conflict does.
 */
export function conflictId(kind: ConflictKind, key: string): string {
  return createHash('sha256').update(`${kind}:${key}`).digest('base64url').slice(0, 12)
}

/* ---------------------------------------------------------- vanished source */

/** What pairing a relationship claim with its reverse direction needs. */
export type PairableClaim = {
  id: string
  subjectId: string
  objectId: string | null
  predicate: string
  inverseName: string | null
  startTime: string | null
  endTime: string | null
}

/** The registry's declared directions: `rules`, not `ruled_by`. */
const DECLARED = new Set<string>(RELATIONSHIPS.map((r) => r.name))

/**
 * Collapses each relationship and its materialised inverse into one entry.
 *
 * Every relationship claim is stored in both directions with its evidence
 * copied (§5), so when a document vanishes, "Sera rules Ashfall" and "Ashfall
 * is ruled by Sera" lose their source together. That is one fact with one
 * missing citation, and two inbox items for it would be asking the user to
 * resolve the same thing twice — resolving either deletes both anyway.
 *
 * The direction the registry declares is the one shown (it is the phrasing
 * the predicate was designed to be read in); a symmetric pair keeps the
 * lower id, which is arbitrary but stable.
 */
export function pairDirections<T extends PairableClaim>(
  claims: readonly T[],
): { claim: T; partnerId: string | null }[] {
  const byId = new Map(claims.map((c) => [c.id, c]))
  const index = new Map<string, T[]>()
  for (const c of claims) {
    if (!c.objectId) continue
    const k = pairKey(c.subjectId, c.objectId, c.predicate, c.startTime, c.endTime)
    const list = index.get(k)
    if (list) list.push(c)
    else index.set(k, [c])
  }

  const taken = new Set<string>()
  const result: { claim: T; partnerId: string | null }[] = []

  for (const claim of claims) {
    if (taken.has(claim.id)) continue
    taken.add(claim.id)

    const partner =
      claim.objectId && claim.inverseName
        ? (index
            .get(pairKey(claim.objectId, claim.subjectId, claim.inverseName, claim.startTime, claim.endTime))
            ?.find((p) => p.id !== claim.id && !taken.has(p.id)) ?? null)
        : null

    if (!partner) {
      result.push({ claim, partnerId: null })
      continue
    }
    taken.add(partner.id)

    const symmetric = claim.predicate === partner.predicate
    const shown = symmetric
      ? claim.id < partner.id ? claim : partner
      : DECLARED.has(claim.predicate) ? claim : partner
    result.push({ claim: byId.get(shown.id)!, partnerId: shown === claim ? partner.id : claim.id })
  }

  return result
}

function pairKey(
  subjectId: string,
  objectId: string,
  predicate: string,
  startTime: string | null,
  endTime: string | null,
): string {
  return [subjectId, objectId, predicate, startTime ?? '', endTime ?? ''].join('|')
}
