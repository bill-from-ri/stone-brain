import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/db'
import { apiRequireReady } from '@/lib/auth/guard'
import { setVerified } from '@/lib/extraction/verify'

const paramsSchema = z.object({ id: z.uuid() })
const bodySchema = z.object({ verified: z.boolean() })

/**
 * Mark a document Verified, or take the mark back.
 *
 * The only field a person may set on a document — everything else on the row
 * is Drive's, mirrored by sync. Hence a body of one boolean rather than a
 * general patch: a field this route does not name cannot be written through it.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await apiRequireReady()
  if (!guard.ok) return guard.response

  const params = paramsSchema.safeParse(await context.params)
  const body = bodySchema.safeParse(await request.json().catch(() => null))
  if (!params.success || !body.success) {
    return NextResponse.json({ ok: false, error: 'Malformed request.' }, { status: 400 })
  }

  const result = await setVerified(db, guard.session.user.id, params.data.id, body.data.verified)

  if (!result.ok) {
    return result.reason === 'not_found'
      ? NextResponse.json({ ok: false, error: 'No such document.' }, { status: 404 })
      : NextResponse.json(
          { ok: false, error: 'Only an extracted document can be marked as verified.' },
          { status: 409 },
        )
  }

  return NextResponse.json({ ok: true, status: result.status })
}
