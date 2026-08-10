'use client'

import { usePathname } from 'next/navigation'
import { SCREEN_TITLES } from './nav'

type Props = {
  subtitle?: string | null
  /** Rendered into the header's right side — the Library supplies its sync controls here. */
  actions?: React.ReactNode
}

export function AppHeader({ subtitle, actions }: Props) {
  const pathname = usePathname()
  const screen = SCREEN_TITLES[pathname] ?? SCREEN_TITLES[`/${pathname.split('/')[1] ?? ''}`]

  return (
    <header className="sb-header">
      <div className="sb-header-title">{screen?.title ?? 'Stone Brain'}</div>
      <div className="sb-header-sub">{subtitle ?? screen?.sub ?? ''}</div>
      <div className="sb-header-spacer" />
      {actions}
    </header>
  )
}
