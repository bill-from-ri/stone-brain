import { requireUser } from '@/lib/auth/guard'
import { AppHeader } from '@/components/shell/AppHeader'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const session = await requireUser()

  return (
    <>
      <AppHeader subtitle={session.user.email} />
      <div className="sb-screen" style={{ padding: '24px 20px', maxWidth: 560 }}>
        <div className="sb-panel">
          <div className="sb-kicker">Account</div>
          <div className="sb-grant">
            <i className="ph ph-user-circle" />
            <div>
              <div className="sb-grant-title">{session.user.name ?? session.user.email}</div>
              <div className="sb-grant-note">
                {session.user.email} — authenticated by Google. Stone Brain stores no password.
              </div>
            </div>
          </div>
        </div>

        <div className="sb-panel">
          <div className="sb-kicker">Drive</div>
          <div className="sb-grant">
            <i className="ph ph-folder-open" />
            <div>
              <div className="sb-grant-title">{session.rootFolderName ?? 'No folder chosen'}</div>
              <div className="sb-grant-note">
                {session.tokenStatus === 'active'
                  ? 'Connected. Stone Brain reads inside this folder and nowhere else.'
                  : 'Disconnected — reconnect to resume syncing. Your library is unaffected.'}
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <form action="/api/auth/signout" method="post">
            <button className="btn btn-secondary" type="submit">
              Sign out
            </button>
          </form>
          {/* Disconnect revokes the Drive grant but deliberately KEEPS the index,
              so reconnecting is instant rather than a re-crawl. */}
          <form action="/api/auth/disconnect" method="post">
            <button className="btn btn-ghost" type="submit">
              Disconnect Drive
            </button>
          </form>
        </div>
      </div>
    </>
  )
}
