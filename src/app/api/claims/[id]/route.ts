import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRequireReady } from '@/lib/auth/guard'
import { getClaim, getClaimSources } from '@/db/queries/claims'
import { deleteClaim } from '@/lib/ontology/claim-writes'

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

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await apiRequireReady()
  if (!guard.ok) return guard.response

  const parsed = paramsSchema.safeParse(await context.params)
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 })

  const withInverse = request.nextUrl.searchParams.get('inverse') === '1'
  const { deleted } = await deleteClaim(guard.session.user.id, parsed.data.id, withInverse)

  return NextResponse.json({ ok: deleted > 0, deleted })
}
