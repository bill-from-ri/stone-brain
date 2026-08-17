import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRequireReady } from '@/lib/auth/guard'
import { deleteClaim } from '@/lib/ontology/claim-writes'

const paramsSchema = z.object({ id: z.uuid() })

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
