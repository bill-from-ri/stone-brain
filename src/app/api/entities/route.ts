import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRequireReady } from '@/lib/auth/guard'
import { createEntity } from '@/lib/ontology/claim-writes'

/**
 * Deliberate, user-initiated entity creation — the claim editor's "new entity"
 * action. The entity matcher never does this (ADR §15); creating something the
 * graph has never heard of is a decision, not a fallback.
 */
const bodySchema = z.object({
  name: z.string().min(1).max(200),
  entityType: z.string().min(1).max(64),
})

export async function POST(request: NextRequest) {
  const guard = await apiRequireReady()
  if (!guard.ok) return guard.response

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Malformed request.' }, { status: 400 })
  }

  const result = await createEntity(guard.session.user.id, parsed.data.name, parsed.data.entityType)
  return NextResponse.json(result, { status: result.ok ? 200 : 422 })
}
