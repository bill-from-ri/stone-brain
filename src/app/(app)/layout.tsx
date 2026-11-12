import { redirect } from 'next/navigation'
import type { Route } from 'next'
import { NavRail } from '@/components/shell/NavRail'
import { ConnectionBanner } from '@/components/shell/ConnectionBanner'
import { getShellCounts } from '@/db/queries/library'
import { countOpenConflicts } from '@/db/queries/conflicts'
import { requireUser, setupStateOf } from '@/lib/auth/guard'

/**
 * The real gate for everything inside the app shell.
 *
 * src/proxy.ts already bounced anyone with no session cookie, but that is a fast
 * path whose coverage depends on a matcher regex. This runs on every render of
 * every page in the group and is what actually enforces the three states.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireUser()
  const state = setupStateOf(session)

  // "No other options should be available until after that": a signed-in user
  // with no root folder gets the picker and nothing else.
  if (state === 'needs_root') redirect('/setup/folder')

  // Together, not in turn. Detection is memoised per request, so a page that
  // reads conflicts too (Conflicts, World) shares this pass rather than repeating it.
  //
  // How often this runs is bounded by the router, not by a cache: a layout is
  // not re-rendered on client navigation between the pages under it, only on a
  // full load and on `router.refresh()` — which every write in the app calls,
  // and which is exactly when the rail's count may have moved. A cross-request
  // cache would make that count lag the write that changed it.
  const [{ documentCount, folderCount }, conflictCount] = await Promise.all([
    getShellCounts(session.user.id),
    countOpenConflicts(session.user.id),
  ])
  const driveConnected = session.tokenStatus === 'active'

  return (
    <div className="sb-app">
      <NavRail
        email={session.user.email}
        pictureUrl={session.user.pictureUrl}
        driveConnected={driveConnected}
        documentCount={documentCount}
        folderCount={folderCount}
        conflictCount={conflictCount}
        // `needs_root` redirected above, so the root folder is known by here.
        libraryHref={`/library/${session.rootDriveFolderId}` as Route}
      />
      <main className="sb-main">
        {!driveConnected && <ConnectionBanner returnTo="/library" />}
        {children}
      </main>
    </div>
  )
}
