import 'server-only'
import { db } from '@/db'
import { mergeEntities as mergeWith, planMerge } from '@/lib/duplicates/merge'
import type { MergePlan } from '@/lib/duplicates/types'

/**
 * Merging entities, for the app: `src/lib/duplicates/merge.ts` bound to the
 * real database. Every export takes userId first and is scoped by it, on the
 * rule every module in db/queries keeps.
 *
 * Finding the duplicates is not here: they are a kind of conflict, and come
 * from `getConflicts` like the others.
 */

export type { MergeBlocker, MergePlan } from '@/lib/duplicates/types'

/** What merging `dropId` into `keepId` would do. Null for an unknown, foreign or identical pair. */
export async function previewMerge(userId: string, keepId: string, dropId: string): Promise<MergePlan | null> {
  return planMerge(db, userId, keepId, dropId)
}

/**
 * Merges `dropId` into `keepId` in one transaction. A plan with blockers means
 * nothing was written; null as for `previewMerge`.
 */
export async function mergeEntities(userId: string, keepId: string, dropId: string): Promise<MergePlan | null> {
  return mergeWith(db, userId, keepId, dropId)
}
