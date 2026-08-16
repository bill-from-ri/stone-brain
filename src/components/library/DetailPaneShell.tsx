'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { Route } from 'next'
import { useEffect, useState } from 'react'

/**
 * The animated frame around the Library's right pane.
 *
 * With nothing selected there is nothing to say, so the pane closes entirely
 * rather than sitting there holding a "Select a document" placeholder — the
 * table gets the space instead.
 *
 * The width transition is on the frame while the body keeps a fixed width, so
 * the content slides out of view instead of reflowing to nothing on the way.
 * That means the body has to survive the close: `held` keeps the last document's
 * markup on screen for the length of the animation, since by the time the pane
 * starts closing the server has already re-rendered with no document at all.
 */
export function DetailPaneShell({
  open,
  children,
}: {
  open: boolean
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const [held, setHeld] = useState<React.ReactNode>(children)

  useEffect(() => {
    if (open) setHeld(children)
  }, [open, children])

  const close = () => {
    const next = new URLSearchParams(params)
    next.delete('doc')
    const qs = next.toString()
    router.replace((qs ? `${pathname}?${qs}` : pathname) as Route, { scroll: false })
  }

  return (
    <aside className="sb-lib-detail" data-open={open} aria-hidden={!open}>
      {/* inert keeps the closing pane's close button and links out of the tab
          order while it is still on screen animating away. */}
      <div className="sb-lib-detail-body" inert={!open}>
        <button
          type="button"
          className="sb-detail-close"
          onClick={close}
          aria-label="Close details"
          title="Close details"
        >
          <i className="ph ph-x" />
        </button>
        {open ? children : held}
      </div>
    </aside>
  )
}
