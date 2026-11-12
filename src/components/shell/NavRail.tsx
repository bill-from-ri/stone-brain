'use client'

import { useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { Route } from 'next'
import { ConflictBadge } from '@/components/conflicts/ConflictBadge'
import { useHydrated } from '@/components/shared/useHydrated'
import { NAV } from './nav'

type Props = {
  email: string
  pictureUrl: string | null
  driveConnected: boolean
  /** Real counts. The prototype's "Graph health" bar has no measure behind it, so it is not drawn. */
  documentCount: number
  folderCount: number
  /** Open (undismissed) conflicts, for the badge on the Conflicts item. */
  conflictCount: number
  /**
   * The canonical Library URL, already resolved to the root folder.
   *
   * /library is only an alias: it is a dynamic page whose whole body is a
   * session lookup followed by a redirect to /library/<rootFolderId>. Linking
   * to it from the rail made the commonest navigation in the product pay for
   * two server renders — the redirect, then the real page — before anything
   * was drawn. The layout already knows the root folder, so the rail points
   * straight at the destination and the alias stays for typed URLs only.
   */
  libraryHref: Route
}

const COLLAPSE_KEY = 'sb:rail-collapsed'

/*
 * The collapsed preference, as a tiny external store over localStorage.
 *
 * The server cannot know it, so the server snapshot is "expanded" and the
 * browser's real value takes over during hydration — `useSyncExternalStore`'s
 * designed case, with no mismatch and no effect-scheduled second render. The
 * `storage` event keeps other tabs in step; this tab's own writes notify
 * directly, since that event never fires in the tab that wrote.
 */
const collapseListeners = new Set<() => void>()
/** This tab's last choice, authoritative once made — and all there is when storage is blocked. */
let collapsedHere: boolean | null = null

function subscribeCollapsed(onChange: () => void) {
  collapseListeners.add(onChange)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== COLLAPSE_KEY) return
    collapsedHere = event.newValue === '1'
    onChange()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    collapseListeners.delete(onChange)
    window.removeEventListener('storage', onStorage)
  }
}

function readCollapsed(): boolean {
  if (collapsedHere !== null) return collapsedHere
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    // Private mode, blocked storage: expanded is a fine answer.
    return false
  }
}

function writeCollapsed(next: boolean) {
  collapsedHere = next
  try {
    window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
  } catch {
    // Not worth failing the interaction over: the rail still toggles, and
    // only forgets the choice on the next load.
  }
  for (const listener of collapseListeners) listener()
}

function initials(email: string): string {
  const [local = ''] = email.split('@')
  const parts = local.split(/[._-]/).filter(Boolean)
  return (parts.length >= 2 ? `${parts[0]![0]}${parts[1]![0]}` : local.slice(0, 2)).toUpperCase()
}

export function NavRail({
  email,
  pictureUrl,
  driveConnected,
  documentCount,
  folderCount,
  conflictCount,
  libraryHref,
}: Props) {
  const pathname = usePathname()
  const [avatarFailed, setAvatarFailed] = useState(false)
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false)

  /**
   * `ready` gates the width transition, so that restoring a collapsed rail
   * lands as its initial state rather than as a visible animation on every
   * page load.
   */
  const ready = useHydrated()

  const toggle = () => writeCollapsed(!collapsed)

  return (
    <nav className="sb-rail" data-collapsed={collapsed} data-ready={ready}>
      <div className="sb-rail-brand">
        <div className="sb-rail-name">Stone Brain</div>
        <button
          type="button"
          className="sb-rail-collapse"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <i className="ph ph-sidebar-simple" />
        </button>
      </div>

      <div className="sb-divider" />

      <div className="sb-rail-nav">
        {NAV.map((item) => {
          const active =
            item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)

          // Phase 2+ screens are reachable so the shell reads as a whole product,
          // but they are design previews with no real data behind them. The phase
          // marker here and the banner on the screen itself both say so.
          const preview = item.phase > 1 ? `Preview — arrives in Phase ${item.phase}` : undefined
          const count = item.badge === 'conflicts' ? conflictCount : 0
          const counted =
            count > 0 ? `${count} open ${count === 1 ? 'conflict' : 'conflicts'}` : undefined

          return (
            <Link
              key={item.href}
              href={item.href === '/library' ? libraryHref : item.href}
              className={`sb-rail-item${active ? ' sb-rail-item--on' : ''}${
                item.phase > 1 ? ' sb-rail-item--preview' : ''
              }`}
              // Collapsed, the icon is all there is, so the tooltip has to carry
              // the label as well.
              title={
                collapsed ? [item.label, preview, counted].filter(Boolean).join(' — ') : preview
              }
            >
              <i className={item.icon} />
              <span className="sb-rail-label">{item.label}</span>
              {item.phase > 1 && <span className="sb-rail-phase">P{item.phase}</span>}
              {/* Zero draws nothing: a "0" beside Conflicts would be one more
                  thing to read that says nothing is wrong. */}
              {count > 0 && <ConflictBadge count={count} />}
            </Link>
          )
        })}
      </div>

      <div className="sb-rail-spacer" />

      {/* Replaces the prototype's "18 of 34 verified" bar with a plain count of
          what is mirrored. How many are verified is on Home, beside what still
          needs reading; a progress bar here would make verifying everything
          look like the goal, when it is a check you choose to make. */}
      <div className="sb-rail-stat">
        {documentCount} {documentCount === 1 ? 'document' : 'documents'} · {folderCount}{' '}
        {folderCount === 1 ? 'folder' : 'folders'}
      </div>

      <Link
        href="/settings"
        className="sb-rail-account"
        title={collapsed ? `${email} — Settings` : undefined}
      >
        {pictureUrl && !avatarFailed ? (
          /*
           * referrerPolicy is load-bearing, not decoration. lh3.googleusercontent.com
           * serves avatars but rejects requests carrying a cross-origin Referer,
           * so the default strict-origin-when-cross-origin turns every one of
           * these into a 403 and the circle renders empty. no-referrer is the
           * fix. onError keeps the initials as a real fallback rather than a
           * blank disc if the URL ever goes stale.
           */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="sb-avatar"
            src={pictureUrl}
            alt=""
            width={24}
            height={24}
            referrerPolicy="no-referrer"
            onError={() => setAvatarFailed(true)}
          />
        ) : (
          <div className="sb-avatar">{initials(email)}</div>
        )}
        <div className="sb-rail-account-text">
          <div className="sb-rail-email">{email}</div>
          <div
            className={`sb-drive-state ${
              driveConnected ? 'sb-drive-state--ok' : 'sb-drive-state--bad'
            }`}
          >
            <i className="ph-bold ph-google-drive-logo" style={{ fontSize: 10 }} />
            {driveConnected ? 'Drive connected' : 'Drive disconnected'}
          </div>
        </div>
        <i className="ph ph-caret-up-down sb-rail-account-caret" />
      </Link>
    </nav>
  )
}
