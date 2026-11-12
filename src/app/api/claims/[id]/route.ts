import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRequireReady } from '@/lib/auth/guard'
import { getClaim, getClaimSources } from '@/db/queries/claims'
import { deleteClaim, updateClaim } from '@/lib/ontology/claim-writes'

const paramsSchema = z.object({ id: z.uuid() })

/**
 * One claim and the passages behind it, for the World screen's right pane.
 *
 * The pane used to be built by the page: selecting a claim wrote `?claim=` to
 * the URL, which re-ran the entire World render — the rail, the table, the
 * graph, the whole ontology — to change one 320px column. The claim row itself
 * is already on the client, since it is the row that was clicked, so the only
 * thing genuinely missing is its sources. This serves them.
 *
 * `claim` is still returned because a link can arrive selecting something the
 * table is not currently showing — a `?claim=` bookmark opened under an entity
 * filter that excludes it — and the pane should open on the real claim rather
 * than silently on nothing.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await apiRequireReady()
  if (!guard.ok) return guard.response

  const parsed = paramsSchema.safeParse(await context.params)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Malformed request.' }, { status: 400 })
  }

  /*
   * Issued together, not one after the other. Sources are keyed by claim id,
   * which the request already carries, so waiting for the claim to come back
   * before asking for them bought nothing and cost a second round trip — and
   * both are already sitting behind the session lookup above.
   *
   * Both queries are scoped to userId, so a claim belonging to someone else
   * returns no row here and no sources either; the 404 below is about a claim
   * this user does not have, however it fails to exist.
   */
  const userId = guard.session.user.id
  const [claim, sources] = await Promise.all([
    getClaim(userId, parsed.data.id),
    getClaimSources(userId, parsed.data.id),
  ])

  if (!claim) return NextResponse.json({ ok: false, error: 'No such claim.' }, { status: 404 })

  return NextResponse.json({ ok: true, claim, sources })
}

/**
 * Editing a claim: its object or value, and its dates. The inverse moves with
 * it — see `updateClaim`. The body is a `ClaimPatch`; an absent field is left
 * alone and a date sent as `null` is cleared.
 */
const patchSchema = z
  .object({
    objectId: z.uuid().optional(),
    value: z.string().max(2000).optional(),
    startTime: z.string().max(120).nullable().optional(),
    endTime: z.string().max(120).nullable().optional(),
  })
  .strict()

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await apiRequireReady()
  if (!guard.ok) return guard.response

  const params = paramsSchema.safeParse(await context.params)
  const body = patchSchema.safeParse(await request.json().catch(() => null))
  if (!params.success || !body.success) {
    return NextResponse.json({ ok: false, error: 'Malformed request.' }, { status: 400 })
  }

  const result = await updateClaim(guard.session.user.id, params.data.id, body.data)

  // As with POST: a refused edit is a designed state with a readable reason.
  return NextResponse.json(result, { status: result.ok ? 200 : 422 })
}

/** Deletes the claim and, always, its inverse — see `deleteClaim`. */
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await apiRequireReady()
  if (!guard.ok) return guard.response

  const parsed = paramsSchema.safeParse(await context.params)
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 })

  const { deleted } = await deleteClaim(guard.session.user.id, parsed.data.id)

  return NextResponse.json({ ok: deleted > 0, deleted })
}
