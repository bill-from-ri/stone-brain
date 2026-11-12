import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRequireReady } from '@/lib/auth/guard'
import { createClaim } from '@/lib/ontology/claim-writes'

/** Hand-authored claims. Extraction gets its own path in Phase 2B. */
const bodySchema = z.object({
  subjectId: z.uuid(),
  predicate: z.string().min(1).max(64),
  objectId: z.uuid().nullish(),
  value: z.string().max(2000).nullish(),
  startTime: z.string().max(120).nullish(),
  endTime: z.string().max(120).nullish(),
})

export async function POST(request: NextRequest) {
  const guard = await apiRequireReady()
  if (!guard.ok) return guard.response

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Malformed request.' }, { status: 400 })
  }

  // userId comes from the session. Never from the request. A relationship's
  // inverse is always written with it; there is no option to decline it.
  const result = await createClaim(guard.session.user.id, parsed.data)

  // A rejected claim is a designed state, not a server error: the message is
  // written to be shown to the person who typed it.
  return NextResponse.json(result, { status: result.ok ? 200 : 422 })
}
