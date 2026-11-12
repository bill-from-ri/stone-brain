import Link from 'next/link'
import type { Route } from 'next'
import type { ConflictKind } from '@/db/schema'
import '@/styles/conflicts.css'

/**
 * The small red (or, for a missing source, gold) marker that says "there is a
 * conflict here" anywhere outside the Conflicts screen: the nav rail's count,
 * a row in the World's claim table, a document in the Library.
 *
 * Presentational and server-safe — no state, no handlers — so a server
 * component can render it, and with `href` it is itself the way to the
 * conflict. The two kinds are coloured differently because they ask different
 * things of the user: a contradiction is a question about the world, a
 * vanished source a question about a citation.
 */
export function ConflictBadge({
  kind = 'value',
  count,
  label,
  href,
  title,
}: {
  kind?: ConflictKind
  /** Shown instead of a label: the Library's per-document count, the rail's total. */
  count?: number
  /** Overrides the default wording. Ignored when `count` is given. */
  label?: string
  href?: Route
  /** Tooltip. Defaults to a sentence naming the kind. */
  title?: string
}) {
  const text = count !== undefined ? String(count) : (label ?? (kind === 'value' ? 'Conflict' : 'Source gone'))
  const tooltip =
    title ??
    (count !== undefined
      ? `${count} open ${count === 1 ? 'conflict' : 'conflicts'}`
      : kind === 'value'
        ? 'Disagrees with another claim'
        : 'Every document this was read from has left the Library')

  const body = (
    <>
      <i className={kind === 'value' ? 'ph-bold ph-warning-diamond' : 'ph-bold ph-link-break'} aria-hidden />
      {text}
    </>
  )

  const className = `sb-conflict-badge sb-conflict-badge--${kind}`

  // On a link the tooltip is also its accessible name: a bare "3" or
  // "Conflict" says nothing about where it goes to someone who cannot see it.
  return href ? (
    <Link href={href} className={className} title={tooltip} aria-label={tooltip}>
      {body}
    </Link>
  ) : (
    <span className={className} title={tooltip}>
      {body}
    </span>
  )
}

/** The Conflicts screen, opened on one conflict. */
export function conflictHref(conflictId: string): Route {
  return `/conflicts?c=${encodeURIComponent(conflictId)}` as Route
}
