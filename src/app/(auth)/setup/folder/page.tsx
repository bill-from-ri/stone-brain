import { requireUser } from '@/lib/auth/guard'

export const dynamic = 'force-dynamic'

/**
 * The in-app root-folder picker. Built from files.list rather than the Google
 * Picker — with drive.readonly we can enumerate the user's Drive directly, so
 * the Picker dependency was dropped entirely (decisions §2).
 *
 * The interactive tree lands in M4; this frame establishes the route the gate
 * redirects to.
 */
export default async function SetupFolderPage() {
  const session = await requireUser()

  return (
    <main className="sb-centered">
      <div className="sb-card">
        <div className="sb-card-brand">
          <div className="sb-card-mark">
            <i className="ph-bold ph-brain" />
          </div>
          <strong>Stone Brain</strong>
        </div>

        <h1>Choose your folder.</h1>
        <p className="sb-card-body">
          Pick the Drive folder that holds your world. Stone Brain mirrors that folder and its
          subfolders, and reads nothing outside it.
        </p>

        <div className="sb-panel">
          <div className="sb-kicker">Signed in as</div>
          <div className="sb-grant">
            <i className="ph ph-user-circle" />
            <div>
              <div className="sb-grant-title">{session.user.email}</div>
              <div className="sb-grant-note">Folder picker arrives in the next step of the build.</div>
            </div>
          </div>
        </div>

        <form action="/api/auth/signout" method="post">
          <button className="btn btn-ghost" type="submit">
            Sign out
          </button>
        </form>
      </div>
    </main>
  )
}
