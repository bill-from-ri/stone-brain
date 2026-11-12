import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRequireReady } from '@/lib/auth/guard'
import { dismissConflict, getConflictsFresh, restoreConflict } from '@/db/queries/conflicts'

/**
 * "Not a conflict" / "Keep it as it stands", and its undo.
 *
 * A dismissal is the only thing about a conflict that is stored, because it is
 * the only thing a query over claims cannot reconstruct: a person having
 * looked and decided. POST records it; DELETE takes it back.
 *
 * Like /api/conflicts/resolve, the request names a conflict by id and the
 * server looks up its key, so the stored key is always one the server derived
 * — a client cannot dismiss an arbitrary string, or a set of claims that is
 * not actually in conflict.
 */

const bodySchema = z.object({ conflictId: z.string().min(1).max(64) })

async function handle(request: NextRequest, action: 'dismiss' | 'restore') {
  const guard = await apiRequireReady()
  if (!guard.ok) return guard.response

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Malformed request.' }, { status: 400 })
  }

  const userId = guard.session.user.id
  const conflict = (await getConflictsFresh(userId)).find((c) => c.id === parsed.data.conflictId)
  if (!conflict) {
    return NextResponse.json(
      { ok: false, error: 'This conflict has changed since the page loaded. Reload to see it as it stands.' },
      { status: 409 },
    )
  }

  if (action === 'dismiss') await dismissConflict(userId, conflict.kind, conflict.key)
  else await restoreConflict(userId, conflict)

  return NextResponse.json({ ok: true })
}

export async function POST(request: NextRequest) {
  return handle(request, 'dismiss')
}

export async function DELETE(request: NextRequest) {
  return handle(request, 'restore')
}
