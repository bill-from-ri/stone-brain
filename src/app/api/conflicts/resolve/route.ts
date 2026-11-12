import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRequireReady } from '@/lib/auth/guard'
import { getConflictsFresh } from '@/db/queries/conflicts'
import { deleteClaim } from '@/lib/ontology/claim-writes'

/**
 * Resolving a conflict by changing the graph.
 *
 *   - `keep`   — a value conflict: keep one side, delete the claims that
 *                disagree with it (each with its reverse direction).
 *   - `delete` — a vanished source: delete the unsupported claim.
 *
 * A possible duplicate is not settled here: it has no claims to keep or
 * delete, and is answered by a merge (`/api/entities/merge`) or a dismissal.
 *
 * Editing a side instead goes through `PATCH /api/claims/[id]`, which is the
 * ordinary claim edit — a conflict needs nothing special to be fixed by giving
 * one side its dates. Accepting a conflict as it stands is a dismissal, and
 * lives at /api/conflicts/dismissals.
 *
 * The request names a conflict by id, never a list of claims to delete. The
 * server re-derives the conflict from the graph as it is now and deletes what
 * *that* says the kept side displaces, so a page left open while another tab
 * edited the graph cannot delete claims that are no longer in the argument.
 * If the conflict has since changed shape its id has changed with it, and the
 * answer is a 409 asking for a reload rather than a guess.
 */

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('keep'), conflictId: z.string().min(1).max(64), claimId: z.uuid() }),
  z.object({ action: z.literal('delete'), conflictId: z.string().min(1).max(64) }),
])

const STALE =
  'This conflict has changed since the page loaded. Reload to see it as it stands.'

export async function POST(request: NextRequest) {
  const guard = await apiRequireReady()
  if (!guard.ok) return guard.response

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Malformed request.' }, { status: 400 })
  }

  // userId comes from the session. Never from the request.
  const userId = guard.session.user.id
  const body = parsed.data
  const conflict = (await getConflictsFresh(userId)).find((c) => c.id === body.conflictId)
  if (!conflict) return NextResponse.json({ ok: false, error: STALE }, { status: 409 })
  if (conflict.kind === 'duplicate') {
    return NextResponse.json(
      { ok: false, error: 'Merge the two, or mark them as not the same, to settle a possible duplicate.' },
      { status: 422 },
    )
  }

  /*
   * Not one transaction. Each deletion goes through `deleteClaim`, which owns
   * carrying the reverse direction and runs on the app's own handle, so there
   * is no transaction to enlist it in. What makes that acceptable is that
   * conflicts are derived: if the request dies halfway, the claims still
   * standing are still in conflict, the inbox shows exactly that, and keeping
   * the same side again finishes the job. Nothing records "resolved" that
   * could disagree with what is actually in the graph.
   */
  let deleted = 0

  if (body.action === 'keep') {
    if (conflict.kind !== 'value') {
      return NextResponse.json({ ok: false, error: 'Only a contradiction has sides to keep.' }, { status: 422 })
    }
    const side = conflict.sides.find((s) => s.claims.some((c) => c.id === body.claimId))
    if (!side) return NextResponse.json({ ok: false, error: STALE }, { status: 409 })

    for (const claimId of side.displaces) {
      deleted += (await deleteClaim(userId, claimId)).deleted
    }
  } else {
    if (conflict.kind !== 'vanished_source') {
      return NextResponse.json(
        { ok: false, error: 'Pick a side to keep, or edit one, to settle a contradiction.' },
        { status: 422 },
      )
    }
    deleted = (await deleteClaim(userId, conflict.claim.id)).deleted
  }

  return NextResponse.json({ ok: true, deleted })
}
