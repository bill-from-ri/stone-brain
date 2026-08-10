'use client'

import { usePathname } from 'next/navigation'
import { SCREEN_TITLES } from './nav'

type Props = {
  subtitle?: string | null
  /** The 300px search field from the prototype. Omitted on screens with nothing to search. */
  search?: React.ReactNode
  /** Right-hand controls — the Library supplies its sync state and button here. */
  actions?: React.ReactNode
}

/** Ported from the prototype's header, lines 90-100. */
export function AppHeader({ subtitle, search, actions }: Props) {
  const pathname = usePathname()
  const screen = SCREEN_TITLES[pathname] ?? SCREEN_TITLES[`/${pathname.split('/')[1] ?? ''}`]

  return (
    <header className="sb-header">
      <div className="sb-header-title">{screen?.title ?? 'Stone Brain'}</div>
      <div className="sb-header-sub">{subtitle ?? screen?.sub ?? ''}</div>
      <div className="sb-header-spacer" />
      {search}
      {actions}
    </header>
  )
}
