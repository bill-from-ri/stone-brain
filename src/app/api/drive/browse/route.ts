import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRequireUser } from '@/lib/auth/guard'
import { DriveBrowser } from '@/lib/drive/browser'
import { DriveAuthError } from '@/lib/google/errors'

/**
 * The ONLY route that reaches unscoped Drive. See the header comment in
 * src/lib/drive/browser.ts for why that capability is quarantined.
 *
 * Note this uses apiRequireUser, not apiRequireReady: it must work in the
 * `needs_root` state, since its entire job is to help the user leave that state.
 */

const querySchema = z.object({
  parent: z.string().min(1).max(256).optional(),
  q: z.string().max(256).optional(),
  pageToken: z.string().max(4096).optional(),
})

export async function GET(request: NextRequest) {
  const guard = await apiRequireUser()
  if (!guard.ok) return guard.response

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams))
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  // userId comes from the session. Never from the request.
  const browser = DriveBrowser.forUser(guard.session.user.id)

  try {
    if (parsed.data.q) {
      return NextResponse.json({ folders: await browser.searchFolders(parsed.data.q) })
    }
    return NextResponse.json(
      await browser.listFolders(parsed.data.parent, parsed.data.pageToken),
    )
  } catch (err) {
    if (err instanceof DriveAuthError) {
      // A designed state, not a crash: the connect screen knows what to do.
      return NextResponse.json({ error: 'drive_auth', reason: err.reason }, { status: 409 })
    }
    console.error('[drive/browse]', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: 'drive_unavailable' }, { status: 502 })
  }
}
