import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRequireReady } from '@/lib/auth/guard'
import { runExtraction } from '@/lib/extraction/run'

/**
 * One request, one document, one model call (plus at most one repair) — the
 * Extract button's endpoint.
 *
 * The whole run happens inside this request. That is deliberate rather than a
 * shortcut: a document's extraction measured 7–8s on the configured model, the
 * worst case recorded was ~195s at default reasoning effort (§4), and the
 * function limit is 300s (ADR §8). A queue would buy nothing for one document
 * but a second place for a run to be lost; §9's unattended drain is where one
 * invocation per document belongs.
 */
export const maxDuration = 300

const paramsSchema = z.object({ id: z.uuid() })

/**
 * Status codes follow the contract `/api/sync` set: a run that *happened* is a
 * 200 whatever its outcome, because a failed extraction is a designed state
 * with a recorded reason, not a server error. Only a run that was refused
 * before it began is a 4xx — 404 for a document this user does not have, 409
 * for one that cannot be extracted right now (removed, no provider, or a run
 * already in flight), each named in `error` so the button can explain it.
 */
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await apiRequireReady()
  if (!guard.ok) return guard.response

  const parsed = paramsSchema.safeParse(await context.params)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'malformed', message: 'Malformed request.' }, { status: 400 })
  }

  // userId comes from the session. Never from the request.
  const outcome = await runExtraction(guard.session.user.id, parsed.data.id)

  if (!outcome.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: outcome.refusal,
        message: outcome.message,
        ...(outcome.startedAt && { startedAt: outcome.startedAt }),
      },
      { status: outcome.refusal === 'not_found' ? 404 : 409, headers: { 'cache-control': 'no-store' } },
    )
  }

  return NextResponse.json({ ok: true, run: outcome.run }, { headers: { 'cache-control': 'no-store' } })
}
