import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { NeonDatabase } from 'drizzle-orm/neon-serverless'
import type * as schema from '@/db/schema'
import { documents, type DocumentStatus } from '@/db/schema'

/**
 * Mark a document Verified, or take the mark back — the last step of a
 * document's extraction lifecycle (unverified → extracted → verified), and the
 * only one a person rather than the write path takes.
 *
 * One conditional UPDATE: the status it moves from is part of the WHERE, so a
 * re-extraction that lands between the click and the write (and resets the
 * document to Extracted) cannot be overwritten by a stale "verify" — the
 * update simply matches nothing. Setting the status a document already has is
 * a success, so a double click is harmless.
 */
export type VerifyResult =
  | { ok: true; status: DocumentStatus }
  | { ok: false; reason: 'not_found' | 'not_extracted' }

export async function setVerified(
  db: NeonDatabase<typeof schema>,
  userId: string,
  documentId: string,
  verified: boolean,
): Promise<VerifyResult> {
  const from: DocumentStatus = verified ? 'extracted' : 'verified'
  const to: DocumentStatus = verified ? 'verified' : 'extracted'

  const [row] = await db
    .update(documents)
    .set({ status: to })
    .where(
      and(
        eq(documents.userId, userId),
        eq(documents.id, documentId),
        isNull(documents.removedAt),
        inArray(documents.status, [from, to]),
      ),
    )
    .returning({ status: documents.status })

  if (row) return { ok: true, status: row.status }

  const [exists] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.userId, userId), eq(documents.id, documentId), isNull(documents.removedAt)))
    .limit(1)

  return { ok: false, reason: exists ? 'not_extracted' : 'not_found' }
}
