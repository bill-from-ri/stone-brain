'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NAV } from './nav'

type Props = {
  email: string
  pictureUrl: string | null
  driveConnected: boolean
  /** Real Phase 1 counts. The prototype's "Graph health" bar is fiction until Phase 3. */
  documentCount: number
  folderCount: number
}

const COLLAPSE_KEY = 'sb:rail-collapsed'

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
}: Props) {
  const pathname = usePathname()
  const [avatarFailed, setAvatarFailed] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  /**
   * The preference is restored after mount, not during render — the server has
   * no way to know it, and rendering it differently there would be a hydration
   * mismatch. `ready` gates the width transition so that restore lands as the
   * rail's initial state rather than as a visible animation on every page load.
   */
  const [ready, setReady] = useState(false)

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1')
    } catch {
      // Private mode, blocked storage: expanded is a fine answer.
    }
    setReady(true)
  }, [])

  const toggle = () => {
    setCollapsed((was) => {
      const next = !was
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
      } catch {
        // Not worth failing the interaction over.
      }
      return next
    })
  }

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

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`sb-rail-item${active ? ' sb-rail-item--on' : ''}${
                item.phase > 1 ? ' sb-rail-item--preview' : ''
              }`}
              // Collapsed, the icon is all there is, so the tooltip has to carry
              // the label as well.
              title={collapsed ? [item.label, preview].filter(Boolean).join(' — ') : preview}
            >
              <i className={item.icon} />
              <span className="sb-rail-label">{item.label}</span>
              {item.phase > 1 && <span className="sb-rail-phase">P{item.phase}</span>}
            </Link>
          )
        })}
      </div>

      <div className="sb-rail-spacer" />

      {/* Replaces the prototype's "18 of 34 verified" bar: a real count, since
          nothing is verified until Phase 2 and a fake percentage would be a lie. */}
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
