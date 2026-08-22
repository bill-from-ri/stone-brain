import type { NeonDatabase } from 'drizzle-orm/neon-serverless'
import type * as schema from '@/db/schema'
import { entities } from '@/db/schema'
import { normalizeName } from './name-key'

/**
 * Minting draft entities for names an extraction found and the graph did not
 * already contain.
 *
 * ## Why this is not in the matcher
 *
 * The matcher answers a question; this answers a different one. `resolve()` is
 * a *lookup* — matched, ambiguous, or none — and it stays pure precisely so
 * that "I could not find this" can never quietly become "so I made one". A
 * matcher that created on a miss would mean every caller that merely wanted to
 * check a name — a search box, a duplicate warning, a preview — could silently
 * grow the graph. Keeping creation here makes it a step someone has to
 * *choose*, in one place, with the provenance to prove it.
 *
 * ## What a draft is, and why an extraction may write one
 *
 * `canonicity: 'draft'` is a real state, not a holding pen: the World view
 * filters on it, and nothing treats a draft as established fact. Combined with
 * `created_by: 'llm'`, a source document, and the model that produced it, an
 * entity minted here is fully traceable and trivially reviewable — which is
 * what makes it safe to write one without asking first. An extractor never
 * mints canon; promoting a draft stays a human act.
 */

export type DraftProposal = {
  name: string
  entityType: string
}

export type DraftContext = {
  /** The document the name was read from, for `entities.source_document_id`. */
  documentId: string | null
  /** The model that proposed it (ADR §11), for `extracted_by_model`. */
  model: string | null
}

export type CreatedDraft = {
  id: string
  name: string
  entityType: string
}

/**
 * Create a draft entity per proposal, in one statement.
 *
 * Deduplicated on the *normalised* name and type before insert, so a document
 * mentioning "the Veche of Andras" and "Veche of Andras" yields one entity
 * rather than two near-identical drafts — the exact near-miss the matcher
 * exists to prevent, which would otherwise walk straight in through this door.
 *
 * Deliberately **not** idempotent against the database: `entities` has no
 * unique constraint on `(user_id, entity_type, normalized_name)` and must not
 * grow one, because two distinct things may legitimately share a name (ADR
 * §15). Callers are responsible for having resolved first; this creates what it
 * is told to create. `writeExtraction` is the caller that does that properly.
 */
export async function createDraftEntities(
  db: NeonDatabase<typeof schema>,
  userId: string,
  proposals: DraftProposal[],
  context: DraftContext,
): Promise<CreatedDraft[]> {
  const unique = new Map<string, DraftProposal>()

  for (const proposal of proposals) {
    const name = proposal.name.trim()
    if (!name) continue
    const key = `${proposal.entityType}|${normalizeName(name)}`
    if (!unique.has(key)) unique.set(key, { name, entityType: proposal.entityType })
  }

  if (unique.size === 0) return []

  return db
    .insert(entities)
    .values(
      [...unique.values()].map((proposal) => ({
        userId,
        entityType: proposal.entityType,
        name: proposal.name,
        normalizedName: normalizeName(proposal.name),
        canonicity: 'draft' as const,
        createdBy: 'llm' as const,
        ...(context.documentId && { sourceDocumentId: context.documentId }),
        ...(context.model && { extractedByModel: context.model }),
      })),
    )
    .returning({ id: entities.id, name: entities.name, entityType: entities.entityType })
}
