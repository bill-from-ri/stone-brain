import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRequireReady } from '@/lib/auth/guard'
import { mergeEntities, previewMerge } from '@/db/queries/duplicates'

/**
 * Merging one entity into another — the Conflicts screen's answer to a
 * possible duplicate.
 *
 *   - `GET ?keep=<id>&drop=<id>` — the plan: what would move, fold or be
 *     recast, and anything in the way. Writes nothing.
 *   - `POST { keepId, dropId }` — the merge. The plan is recomputed inside the
 *     transaction rather than taken from the preview, so a graph edited since
 *     the preview is merged as it is now; a blocker found then is a 409 with
 *     the plan, and nothing written.
 *
 * Unlike the conflict routes this names entities rather than a conflict id:
 * a merge is an edit to the graph that is meaningful whether or not the
 * duplicate check suggested it, and the person may pick either survivor.
 * Ownership is the merge's own check — an entity that is not this user's is
 * a 404, never a hint that it exists.
 */

const pairSchema = z
  .object({ keepId: z.uuid(), dropId: z.uuid() })
  .refine((p) => p.keepId !== p.dropId, 'An entity cannot be merged into itself.')

const NOT_FOUND = 'One of these entities no longer exists. Reload to see the graph as it stands.'
const BLOCKED = 'Some claims cannot move onto the entity you are keeping. Nothing was merged.'

export async function GET(request: NextRequest) {
  const guard = await apiRequireReady()
  if (!guard.ok) return guard.response

  const params = request.nextUrl.searchParams
  const parsed = pairSchema.safeParse({ keepId: params.get('keep'), dropId: params.get('drop') })
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Malformed request.' }, { status: 400 })
  }

  // userId comes from the session. Never from the request.
  const plan = await previewMerge(guard.session.user.id, parsed.data.keepId, parsed.data.dropId)
  if (!plan) return NextResponse.json({ ok: false, error: NOT_FOUND }, { status: 404 })
  return NextResponse.json({ ok: true, plan })
}

export async function POST(request: NextRequest) {
  const guard = await apiRequireReady()
  if (!guard.ok) return guard.response

  const parsed = pairSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Malformed request.' }, { status: 400 })
  }

  const plan = await mergeEntities(guard.session.user.id, parsed.data.keepId, parsed.data.dropId)
  if (!plan) return NextResponse.json({ ok: false, error: NOT_FOUND }, { status: 404 })
  if (plan.blockers.length > 0) {
    return NextResponse.json({ ok: false, error: BLOCKED, plan }, { status: 409 })
  }
  return NextResponse.json({ ok: true, plan })
}
