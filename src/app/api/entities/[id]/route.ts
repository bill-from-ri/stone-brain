import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRequireReady } from '@/lib/auth/guard'
import { deleteEntity } from '@/lib/ontology/claim-writes'

const paramsSchema = z.object({ id: z.uuid() })

/**
 * Deleting an entity, which cascades into every claim it appears in — see the
 * note on `deleteEntity`. The confirmation the user answers before this is
 * called names that count; this route is the point of no return, not the place
 * the warning lives.
 */
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await apiRequireReady()
  if (!guard.ok) return guard.response

  const parsed = paramsSchema.safeParse(await context.params)
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 })

  const { deleted, claimsDeleted } = await deleteEntity(guard.session.user.id, parsed.data.id)

  if (deleted === 0) {
    return NextResponse.json({ ok: false, error: 'No such entity.' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, claimsDeleted })
}
