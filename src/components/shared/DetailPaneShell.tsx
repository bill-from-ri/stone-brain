'use client'

import { useEffect, useState } from 'react'
import { useParamWriter } from './RecordTable'

/**
 * The animated frame around a screen's right-hand pane. Shared by the Library
 * and Claims, which previously had a collapsing pane and a static one.
 *
 * With nothing selected there is nothing to say, so the pane closes entirely
 * rather than sitting there holding a "Select a document" placeholder — the
 * table gets the space instead.
 *
 * The width transition is on the frame while the body keeps a fixed width, so
 * the content slides out of view instead of reflowing to nothing on the way.
 * That means the body has to survive the close: `held` keeps the last
 * selection's markup on screen for the length of the animation, since by the
 * time the pane starts closing the server has already re-rendered with nothing
 * selected at all.
 */
export function DetailPaneShell({
  open,
  clears,
  onClose,
  width = 290,
  children,
}: {
  open: boolean
  /**
   * Query params the close button drops — `doc` on the Library.
   *
   * Ignored when `onClose` is given. The World screen keeps its selection in
   * client state so its pane can open without a round trip, and there closing
   * is a state change that writes the URL afterwards rather than a URL edit
   * that the server has to answer before anything moves.
   */
  clears?: string[]
  onClose?: () => void
  width?: number
  children: React.ReactNode
}) {
  const setParams = useParamWriter()
  const [held, setHeld] = useState<React.ReactNode>(children)

  useEffect(() => {
    if (open) setHeld(children)
  }, [open, children])

  const close = () =>
    onClose ? onClose() : setParams((p) => (clears ?? []).forEach((key) => p.delete(key)))

  return (
    <aside
      className="sb-detail-pane"
      data-open={open}
      aria-hidden={!open}
      style={{ ['--sb-detail-w' as string]: `${width}px` }}
    >
      {/* inert keeps the closing pane's close button and links out of the tab
          order while it is still on screen animating away. */}
      <div className="sb-detail-pane-body" inert={!open}>
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
