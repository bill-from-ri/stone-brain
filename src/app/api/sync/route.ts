import { NextResponse, type NextRequest } from 'next/server'
import { apiRequireReady } from '@/lib/auth/guard'
import { BACKGROUND_BUDGET_MS, BROWSER_BUDGET_MS, syncRoot } from '@/lib/sync/sync-root'

/**
 * POST because it mutates, and because nothing should ever cache it.
 *
 * Answers HTTP 200 for every designed state — including a dead Drive grant and
 * "another invocation holds the lease". The contract is "here is the state of
 * the Drive connection", and a broken connection is a valid state, not a 500.
 * Only genuine bugs produce a non-200.
 */
export async function POST(request: NextRequest) {
  const guard = await apiRequireReady()
  if (!guard.ok) return guard.response

  // A manual "Sync Drive" click can afford to run long; the Library's 20s poll
  // must yield quickly so the UI stays responsive.
  const manual = request.nextUrl.searchParams.get('manual') === '1'

  const result = await syncRoot(guard.session.user.id, {
    budgetMs: manual ? BACKGROUND_BUDGET_MS : BROWSER_BUDGET_MS,
  })

  return NextResponse.json(result, {
    headers: { 'cache-control': 'no-store' },
  })
}
