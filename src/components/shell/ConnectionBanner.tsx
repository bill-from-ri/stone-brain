/**
 * The `reconnect` state made visible.
 *
 * Deliberately a banner and not a redirect: when a refresh token dies, the
 * Postgres projection is still valid and completely readable — only freshness is
 * broken. Hiding someone's Library because Google expired a token would be
 * punishing them for it. Decisions §2 calls this a first-class UI state, and
 * this is what that means concretely.
 */
export function ConnectionBanner({ returnTo }: { returnTo: string }) {
  return (
    <div className="sb-banner" role="status">
      <i className="ph-bold ph-plugs" />
      <div className="sb-banner-text">
        Stone Brain can&rsquo;t reach your Drive folder. Your library is still here, but it
        won&rsquo;t pick up changes until you reconnect.
      </div>
      <a
        className="btn btn-secondary"
        href={`/api/auth/google/start?reconnect=1&returnTo=${encodeURIComponent(returnTo)}`}
      >
        Reconnect Google Drive
      </a>
    </div>
  )
}
