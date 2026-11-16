import type { claims } from '@/db/schema'
import { deriveOntology } from './registry'

/**
 * The reverse direction of a relationship claim.
 *
 * Relationships are directional, and a graph holding only the direction a
 * document happened to state answers "who rules Ashfall" but not "what does
 * Sera rule". So every relationship claim has its inverse materialised beside
 * it — by every write path, from the same function, so the two directions are
 * consistent by construction rather than by each path remembering how:
 *
 *   - hand entry (`claim-writes.ts`), where editing or deleting one direction
 *     carries the other with it;
 *   - extraction (`extraction-write.ts`), in the same transaction as the claim;
 *   - the hand-seeded ground truth (`ground-truth.ts`);
 *   - `scripts/backfill-inverses.ts`, for rows written before any of this.
 *
 * This module is pure: it decides *what* the inverse is. Writing it, deduping
 * it and copying its evidence is `inverse-write.ts`.
 */

/** What this module needs to know about a predicate. */
export type InverseVocabulary = ReadonlyMap<string, { kind: string; inverseName: string | null }>

/**
 * The registry's vocabulary — the same one `parseExtraction()` validates
 * against, so a claim that got past it always has the inverse the registry
 * declares. The backfill passes the database's own `predicates` table instead,
 * since it is mending rows that table already governs.
 */
const CORE: InverseVocabulary = new Map(
  deriveOntology().predicates.map((p) => [p.name, { kind: p.kind, inverseName: p.inverseName }]),
)

type ClaimInsert = typeof claims.$inferInsert

/**
 * The fields an inverse is built from. Everything else on a claim row — its
 * id, fingerprint, timestamps — belongs to that row and must not be copied, so
 * this is a pick rather than the whole row: spreading a selected row into an
 * insert would carry its `id` along and collide with the original.
 *
 * Nullable where a selected row is nullable, so a row read back from the
 * database can be handed in as it is.
 */
export type InverseInput = {
  userId: string
  subjectId: string
  subjectType: string
  predicate: string
  objectId: string | null | undefined
  objectType: string | null | undefined
  startTime?: string | null
  startOrder?: number | null
  endTime?: string | null
  endOrder?: number | null
  canonicity?: ClaimInsert['canonicity']
  createdBy?: ClaimInsert['createdBy']
  extractedByModel?: string | null
  confidence?: number | null
  workspaceId?: string | null
}

/**
 * The insert row for a claim's reverse direction, or null when it has none.
 *
 * Null for an attribute (there is no "other end" to read it from), and for a
 * relationship whose predicate declares no inverse. A symmetric predicate
 * names itself as its inverse, so `married_to` comes back as the same verb
 * with the ends swapped and needs no special case here.
 *
 * Carried over unchanged: the time bounds, because "Sera ruled Ashfall from
 * 400 to 412" and "Ashfall was ruled by Sera from 400 to 412" are one fact
 * read from either end; and the provenance, because the inverse is no more
 * canon, and no less extracted, than the claim it mirrors.
 */
export function inverseOf(
  claim: InverseInput,
  vocabulary: InverseVocabulary = CORE,
): ClaimInsert | null {
  if (!claim.objectId || !claim.objectType) return null

  const def = vocabulary.get(claim.predicate)
  if (!def || def.kind !== 'relationship' || !def.inverseName) return null

  return {
    userId: claim.userId,
    subjectId: claim.objectId,
    subjectType: claim.objectType,
    predicate: def.inverseName,
    objectId: claim.subjectId,
    objectType: claim.subjectType,
    // `undefined` rather than `null` for an absent field, so the insert falls
    // back to the column default instead of writing an explicit null over it.
    ...defined({
      startTime: claim.startTime,
      startOrder: claim.startOrder,
      endTime: claim.endTime,
      endOrder: claim.endOrder,
      canonicity: claim.canonicity,
      createdBy: claim.createdBy,
      extractedByModel: claim.extractedByModel,
      confidence: claim.confidence,
      workspaceId: claim.workspaceId,
    }),
  }
}

/** The inverse predicate's name alone, for previews that have no row to build. */
export function inversePredicate(
  predicate: string,
  vocabulary: InverseVocabulary = CORE,
): string | null {
  const def = vocabulary.get(predicate)
  return def?.kind === 'relationship' ? def.inverseName : null
}

function defined<T extends Record<string, unknown>>(fields: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== null && v !== undefined),
  ) as Partial<T>
}
