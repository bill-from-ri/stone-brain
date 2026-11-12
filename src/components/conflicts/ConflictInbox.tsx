import Link from 'next/link'
import type { Route } from 'next'
import type { Conflict } from '@/db/queries/conflicts'
import { metaOf, titleOf } from './copy'

export type InboxView = 'open' | 'dismissed'

/** The page's URL for a selection, so the inbox and the page cannot disagree on its shape. */
export function inboxHref(view: InboxView, conflictId?: string): Route {
  const params = new URLSearchParams()
  if (view === 'dismissed') params.set('view', 'dismissed')
  if (conflictId) params.set('c', conflictId)
  const query = params.toString()
  return (query ? `/conflicts?${query}` : '/conflicts') as Route
}

/**
 * The left column, from the prototype's "Conflict inbox" (lines 518-536).
 *
 * Contradictions are listed before missing sources, and possible duplicates
 * last, each under its own heading: the three kinds ask for different
 * decisions, and a list that interleaved them would make every item a guess
 * about which one it is. Duplicates go last because they are the weakest
 * signal — a resemblance between names, not a disagreement in the claims. Dismissed conflicts are
 * a second tab rather than hidden, because "not a conflict" has to be
 * reversible to be safe to click.
 *
 * A server component: every item is a link, and selection lives in `?c=`, so
 * there is no client state to keep.
 */
export function ConflictInbox({
  conflicts,
  view,
  selectedId,
  openCount,
  dismissedCount,
}: {
  /** Already filtered to the tab being shown. */
  conflicts: Conflict[]
  view: InboxView
  selectedId: string | null
  openCount: number
  dismissedCount: number
}) {
  const value = conflicts.filter((c) => c.kind === 'value')
  const vanished = conflicts.filter((c) => c.kind === 'vanished_source')
  const duplicates = conflicts.filter((c) => c.kind === 'duplicate')

  return (
    <aside className="sb-cf-inbox" aria-label="Conflicts">
      <div className="sb-cf-inbox-head">
        <div className="sb-cf-inbox-title">Conflict inbox</div>
      </div>

      <nav className="sb-cf-tabs" aria-label="Which conflicts">
        <Link
          href={inboxHref('open')}
          className={`sb-cf-tab${view === 'open' ? ' sb-cf-tab--on' : ''}`}
          aria-current={view === 'open' ? 'page' : undefined}
        >
          Open {openCount}
        </Link>
        <Link
          href={inboxHref('dismissed')}
          className={`sb-cf-tab${view === 'dismissed' ? ' sb-cf-tab--on' : ''}`}
          aria-current={view === 'dismissed' ? 'page' : undefined}
        >
          Dismissed {dismissedCount}
        </Link>
      </nav>

      <div className="sb-cf-list">
        {conflicts.length === 0 && (
          <p className="sb-ent-note">
            {view === 'open' ? 'Nothing open.' : 'Nothing dismissed.'}
          </p>
        )}
        <Group title="Contradictions" conflicts={value} view={view} selectedId={selectedId} />
        <Group title="Missing sources" conflicts={vanished} view={view} selectedId={selectedId} />
        <Group title="Possible duplicates" conflicts={duplicates} view={view} selectedId={selectedId} />
      </div>

      <div className="sb-cf-inbox-foot">
        Conflicts are worked out from your claims each time you look. Fix a claim and its
        conflict goes; nothing needs closing.
      </div>
    </aside>
  )
}

function Group({
  title,
  conflicts,
  view,
  selectedId,
}: {
  title: string
  conflicts: Conflict[]
  view: InboxView
  selectedId: string | null
}) {
  if (conflicts.length === 0) return null
  return (
    <>
      <div className="sb-cf-group">
        {title} · {conflicts.length}
      </div>
      {conflicts.map((conflict) => (
        <Link
          key={conflict.id}
          href={inboxHref(view, conflict.id)}
          className={`sb-cf-item${conflict.id === selectedId ? ' sb-cf-item--on' : ''}`}
          aria-current={conflict.id === selectedId ? 'true' : undefined}
        >
          <div className="sb-cf-item-title">
            <span className={`sb-cf-dot sb-cf-dot--${conflict.kind}`} aria-hidden />
            <span>{titleOf(conflict)}</span>
          </div>
          <div className="sb-cf-item-meta">{metaOf(conflict)}</div>
        </Link>
      ))}
    </>
  )
}
