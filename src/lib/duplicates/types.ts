/**
 * The shapes the duplicate check hands to the Conflicts screen. Types only, so
 * the browser can hold them.
 *
 * A possible duplicate is a pair of entities whose names say "one thing, two
 * spellings" — `giants` beside `Giant`, `Count Aldo Demard` beside `Aldo
 * Demard`. It is listed as a third kind of conflict because it asks the same
 * kind of question the other two do (is the graph saying something it should
 * not?) and is settled the same way: act on it, or dismiss it.
 */

/** Why the pair was suggested. One pair may carry several. */
export type DuplicateReasonCode =
  /** One's name is recorded as a variant of the other. */
  | 'variant'
  /** The names differ only by a plural: `giants` / `Giant`. */
  | 'plural'
  /** One name is the other with a title in front: `Count Aldo Demard`. */
  | 'title'
  /** The same words in a different order: `Innenbeck Province` / `Province of Innenbeck`. */
  | 'word_order'
  /** One name is the other plus a generic place word: `Interior Basin` / `Interior`. */
  | 'generic_word'

export type DuplicateReason = {
  code: DuplicateReasonCode
  /** One sentence naming the words involved, for the screen. */
  text: string
}

export type DuplicateEntity = {
  id: string
  name: string
  entityType: string
  nameVariants: string[]
  canonicity: string
  /** `seed` | `user` | `llm` */
  createdBy: string
  /** Claims with this entity at either end, both directions counted. */
  claimCount: number
  /** Documents cited by those claims, by live name where the document is still known. */
  documents: { id: string; name: string }[]
}

export type DuplicateConflict = {
  kind: 'duplicate'
  /** Short, URL-safe; derived from the key. */
  id: string
  /** The two entity ids, sorted, joined with `|` — what a dismissal stores. */
  key: string
  dismissed: boolean
  /**
   * The suggested survivor first: canon before draft, hand-made before
   * extracted, then more claims, then the earlier entity. A suggestion only —
   * the person chooses.
   */
  entities: [DuplicateEntity, DuplicateEntity]
  reasons: DuplicateReason[]
  /** Entities a claim connects to both, which is what makes a pair more than a name coincidence. */
  sharedNeighbours: { id: string; name: string; entityType: string }[]
  crossType: boolean
}

/* ------------------------------------------------------------------- merging */

/** A claim the merge cannot carry onto the survivor as it stands. */
export type MergeBlocker = {
  claimId: string
  /** "Gabelford located in Innenbeck Province" */
  sentence: string
  /** Why the survivor's type will not take it. */
  reason: string
}

/** What a merge will do (a preview) or did (the result). Same shape for both. */
export type MergePlan = {
  keep: { id: string; name: string; entityType: string }
  drop: { id: string; name: string; entityType: string }
  /** Claims moved onto the survivor unchanged. */
  repointed: number
  /** Claims the survivor already has; their citations move across and the copy goes. */
  folded: number
  /** Claims whose predicate changes so the survivor's type accepts them. */
  recast: { claimId: string; from: string; to: string; sentence: string }[]
  /** Names added to the survivor's variants: the dropped name and its own variants. */
  variantsAdded: string[]
  /** Non-empty means the merge will not run. */
  blockers: MergeBlocker[]
}
