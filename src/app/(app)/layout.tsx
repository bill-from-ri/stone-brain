import { redirect } from 'next/navigation'
import { NavRail } from '@/components/shell/NavRail'
import { ConnectionBanner } from '@/components/shell/ConnectionBanner'
import { getShellCounts } from '@/db/queries/library'
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

  const { documentCount, folderCount } = await getShellCounts(session.user.id)
  const driveConnected = session.tokenStatus === 'active'

  return (
    <div className="sb-app">
      <NavRail
        email={session.user.email}
        pictureUrl={session.user.pictureUrl}
        driveConnected={driveConnected}
        documentCount={documentCount}
        folderCount={folderCount}
      />
      <main className="sb-main">
        {!driveConnected && <ConnectionBanner returnTo="/library" />}
        {children}
      </main>
    </div>
  )
}
