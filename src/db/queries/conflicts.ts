import 'server-only'
import { cache } from 'react'
import { db } from '@/db'
import type { ConflictKind } from '@/db/schema'
import {
  claimIdsOf,
  dismissConflict as dismissWith,
  documentIdsOf,
  loadConflicts,
  restoreConflict as restoreWith,
  type Conflict,
} from '@/lib/conflicts/load'

/**
 * Conflicts, for the app: `src/lib/conflicts/load.ts` bound to the real
 * database. Every export takes userId first and is scoped by it, on the rule
 * every module in db/queries keeps.
 *
 * Detection is one pass over the whole graph and several screens want a
 * different cut of its answer in the same render — the nav rail's count, the
 * Conflicts inbox, the marks on the World's claim table — so the pass is
 * memoised per request with React's `cache`. One render, one detection,
 * however many readers. Nothing is cached *across* requests: conflicts are
 * derived so that they cannot go stale, and a cross-request cache would bring
 * staleness straight back.
 */

export type {
  Conflict,
  ConflictClaim,
  ConflictSide,
  ConflictSource,
  ValueConflict,
  VanishedSourceConflict,
} from '@/lib/conflicts/load'

const conflictsFor = cache((userId: string) => loadConflicts(db, userId))

/** Every conflict, open and dismissed: value conflicts first, then vanished sources. */
export async function getConflicts(userId: string): Promise<Conflict[]> {
  return conflictsFor(userId)
}

/** For the nav rail. Dismissed conflicts are not open. */
export async function countOpenConflicts(userId: string): Promise<number> {
  return (await conflictsFor(userId)).filter((c) => !c.dismissed).length
}

/**
 * Document id → number of open conflicts involving a claim that cites it, for
 * the Library. A conflict citing one document from both sides counts once for
 * it; a document with none is absent rather than zero.
 */
export async function getConflictCountsByDocument(userId: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  for (const conflict of await conflictsFor(userId)) {
    if (conflict.dismissed) continue
    for (const id of documentIdsOf(conflict)) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}

/** What the claim table needs to mark a row: which open conflict, and what kind. */
export type ClaimConflictMark = { kind: ConflictKind; conflictId: string }

/**
 * Claim id → the open conflict it is part of. A claim on both kinds — a
 * contested ruler whose document has also vanished — is marked with the value
 * conflict, which is the one that needs a decision about the world rather than
 * about a citation.
 *
 * Both directions of a relationship are marked, though the inbox shows each
 * conflict from one end: the World's table lists both rows, and "Sera rules
 * Ashfall" is as contested as "Ashfall is ruled by Sera" when Orin rules it
 * too. `claimIdsOf` carries the mirrors for exactly this.
 */
export async function getClaimConflictMarks(userId: string): Promise<Map<string, ClaimConflictMark>> {
  const marks = new Map<string, ClaimConflictMark>()
  for (const conflict of await conflictsFor(userId)) {
    if (conflict.dismissed) continue
    for (const claimId of claimIdsOf(conflict)) {
      if (!marks.has(claimId)) marks.set(claimId, { kind: conflict.kind, conflictId: conflict.id })
    }
  }
  return marks
}

/**
 * Re-reads conflicts, bypassing the per-request memo — for a write path that
 * must act on the graph as it is *now*, not as it was at the start of the
 * request.
 */
export async function getConflictsFresh(userId: string): Promise<Conflict[]> {
  return loadConflicts(db, userId)
}

export async function dismissConflict(userId: string, kind: ConflictKind, key: string) {
  await dismissWith(db, userId, kind, key)
}

export async function restoreConflict(userId: string, conflict: Conflict) {
  await restoreWith(db, userId, conflict)
}
