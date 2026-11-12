import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Connect' }

/**
 * Ported from the prototype's `connect` screen (frontend/Stone Brain.dc.html,
 * lines 727-754), with the three access bullets rewritten.
 *
 * Two of the prototype's bullets were wrong: "Write drafts back, on your say-so"
 * contradicts decisions §10 (Drive writes were dropped entirely), and "One folder
 * and its subfolders. Nothing else in your Drive" describes an OAuth guarantee
 * that does not exist — the folder restriction is our application-level policy,
 * enforced in one place (src/lib/drive/scope.ts), not something Google enforces.
 *
 * The footnote is deliberate. Google's consent screen is the very next thing the
 * user sees and it says "See and download all your Google Drive files" in
 * Google's words; a connect screen that hasn't prepared them for that loses
 * people at exactly the wrong moment. Decisions §2 records this honesty as a
 * decision, not a preference.
 */

const GRANTS = [
  {
    icon: 'ph-folder-open',
    title: 'Read the documents in the folder you choose',
    note: 'Stone Brain reads inside that folder and its subfolders. Nothing outside it is indexed, stored, or shown.',
  },
  {
    icon: 'ph-prohibit',
    title: 'Nothing is written to Drive, ever',
    note: 'The connection is read-only. Drafts from the assistant are yours to copy or download.',
  },
  {
    icon: 'ph-graph',
    title: 'The claim graph lives here, not in Drive',
    note: 'Extracted claims are stored in Stone Brain and can be deleted at any time.',
  },
]

/** Failure codes set by the OAuth callback. Each is a state the user can act on. */
const FAILURES: Record<string, string> = {
  denied: 'You cancelled the Google sign-in. Nothing was connected.',
  oauth: 'Google refused the sign-in request. Try again in a moment.',
  expired: 'That sign-in attempt timed out. Start again.',
  state: 'That sign-in could not be verified, so it was rejected. Start again.',
  exchange: 'Google would not complete the sign-in. Try again in a moment.',
  idtoken: "Google's response could not be verified. Try again.",
  scope:
    'Drive read access was not granted. Stone Brain cannot read your documents without it, so there is nothing it could show you.',
  norefresh:
    'Google did not return the long-lived permission Stone Brain needs to keep your library up to date. Try again and accept the consent screen.',
  disconnected: 'Drive is disconnected. Your library is still here — reconnect to resume syncing.',
}

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>
}) {
  const { e } = await searchParams
  const failure = e ? FAILURES[e] : undefined

  return (
    <main className="sb-centered">
      <div className="sb-card">
        <div className="sb-card-brand">
          <div className="sb-card-mark">
            <i className="ph ph-diamond" />
          </div>
          <strong>Stone Brain</strong>
        </div>

        <h1>Point it at your world.</h1>
        <p className="sb-card-body">
          Stone Brain reads the documents in one Drive folder, extracts the claims they make, and
          tells you when they disagree with each other. Nothing is ever written back.
        </p>

        {failure && (
          <div className="sb-banner" role="alert" style={{ borderRadius: 8, marginBottom: 18 }}>
            <i className="ph-bold ph-warning-circle" />
            <div className="sb-banner-text">{failure}</div>
          </div>
        )}

        <div className="sb-panel">
          <div className="sb-kicker">Access requested</div>
          {GRANTS.map((g) => (
            <div className="sb-grant" key={g.title}>
              <i className={`ph ${g.icon}`} />
              <div>
                <div className="sb-grant-title">{g.title}</div>
                <div className="sb-grant-note">{g.note}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Wired to the real OAuth flow in M2. */}
        <a className="btn btn-primary btn-block" href="/api/auth/google/start">
          <i className="ph-bold ph-google-logo" />
          &nbsp;Connect Google Drive
        </a>

        <p className="sb-footnote">
          Google grants Drive read access at the account level — it has no folder-scoped permission
          to offer. Stone Brain narrows it to your folder and never reads outside it.
        </p>
      </div>
    </main>
  )
}
