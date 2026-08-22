import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRequireUser } from '@/lib/auth/guard'
import { deleteProvider, saveProvider, verifyProvider } from '@/lib/llm/provider'

/**
 * The user's own inference credentials (decisions §11).
 *
 * `apiRequireUser` rather than `apiRequireReady`: configuring a provider has
 * nothing to do with Drive, and someone whose Drive grant has lapsed should
 * still be able to fix or remove a key.
 *
 * Note what this route does not have: a GET. The key is never sent to the
 * browser, and the display-safe status is read by the Settings server component
 * directly, so there is no endpoint here that could be made to leak one.
 */

const bodySchema = z.object({
  baseUrl: z.string().min(1).max(500),
  modelId: z.string().min(1).max(200),
  /** Absent means "keep the key already on file" — see SaveProviderInput. */
  apiKey: z.string().min(1).max(500).optional(),
})

/** Save and verify. The probe result comes back in the same response. */
export async function POST(request: NextRequest) {
  const guard = await apiRequireUser()
  if (!guard.ok) return guard.response

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Malformed request.' }, { status: 400 })
  }

  const result = await saveProvider(guard.session.user.id, parsed.data)
  return NextResponse.json(result, { status: result.ok ? 200 : 422 })
}

/** Re-check what is already stored, without changing it. */
export async function PATCH() {
  const guard = await apiRequireUser()
  if (!guard.ok) return guard.response

  const status = await verifyProvider(guard.session.user.id)
  if (!status) {
    return NextResponse.json({ ok: false, error: 'No provider is configured.' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, status })
}

export async function DELETE() {
  const guard = await apiRequireUser()
  if (!guard.ok) return guard.response

  await deleteProvider(guard.session.user.id)
  return NextResponse.json({ ok: true })
}
