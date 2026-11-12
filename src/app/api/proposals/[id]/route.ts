import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/db'
import { apiRequireUser } from '@/lib/auth/guard'
import { decideProposal } from '@/lib/extraction/record'

const paramsSchema = z.object({ id: z.uuid() })
const bodySchema = z.object({ status: z.enum(['promoted', 'rejected', 'open']) })

/**
 * Decide a vocabulary proposal: promote it, reject it, or reopen it.
 *
 * Acts on the proposal's *name* — every sighting of it, from every document —
 * because the decision is about whether the vocabulary should have that
 * predicate, not about one document's request for it (see `decideProposal`).
 *
 * Promoting records that the registry should grow. It does not add the
 * predicate: the vocabulary is global and curated, so that is a registry edit
 * and a re-seed by a maintainer.
 *
 * `apiRequireUser` rather than `apiRequireReady`, matching the Settings page it
 * serves: a queue that already exists stays decidable whether or not a Drive
 * folder is currently chosen.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await apiRequireUser()
  if (!guard.ok) return guard.response

  const params = paramsSchema.safeParse(await context.params)
  const body = bodySchema.safeParse(await request.json().catch(() => null))
  if (!params.success || !body.success) {
    return NextResponse.json({ ok: false, error: 'Malformed request.' }, { status: 400 })
  }

  const result = await decideProposal(db, guard.session.user.id, params.data.id, body.data.status)
  if (!result) return NextResponse.json({ ok: false, error: 'No such proposal.' }, { status: 404 })

  return NextResponse.json({ ok: true, ...result })
}
