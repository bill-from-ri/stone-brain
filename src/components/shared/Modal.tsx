'use client'

import { useEffect, useId, useRef } from 'react'

/**
 * The frame every modal in the product is built from: a scrim that takes the
 * click, a panel that takes the focus, and Escape bound to close.
 *
 * Two things use it, and they want opposite things from a stray click, which is
 * what `dismissOnScrim` is for. A confirmation holds nothing, so clicking away
 * is a perfectly good "no". An editor holds a half-typed claim, and losing it
 * to a click that missed the panel is exactly the quiet loss this product is
 * meant not to do — so there, the way out is the X, Cancel, or Escape, all of
 * which are deliberate.
 *
 * Deliberately not a `<dialog>` element: `showModal()` wants an imperative
 * open/close kept in sync with React state, and its ::backdrop is awkward to
 * theme. A fixed overlay with focus moved into it is the same behaviour with
 * none of that.
 */
export function Modal({
  open,
  title,
  icon,
  wide = false,
  showClose = false,
  dismissOnScrim = true,
  busy = false,
  role = 'dialog',
  onClose,
  children,
}: {
  open: boolean
  title: string
  /** A Phosphor class, when the title deserves one. */
  icon?: string
  /** For a form. The default is sized for a sentence and two buttons. */
  wide?: boolean
  showClose?: boolean
  dismissOnScrim?: boolean
  /** While true, nothing dismisses the modal — a write is in flight. */
  busy?: boolean
  /** `alertdialog` for a destructive confirmation, which interrupts. */
  role?: 'dialog' | 'alertdialog'
  onClose: () => void
  children: React.ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  // Per instance: an editor modal and a confirmation can share a page, and two
  // panels pointing aria-labelledby at one id would both be named by the first.
  const titleId = useId()

  /*
   * Focus goes back where it came from on close — the Edit or Delete button
   * that opened this — rather than falling to <body>, which leaves a keyboard
   * user at the top of the document after every dialog.
   *
   * Read before the focus effect below moves it (effects run in order), and
   * skipped when a field inside already took it with `autoFocus` — that
   * happens at commit, before any effect, so the opener is no longer knowable
   * and there is nothing better to restore than the default.
   */
  useEffect(() => {
    if (!open) return
    const active = document.activeElement
    const opener = panel.current?.contains(active) ? null : active
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [open])

  /*
   * Focus moves into the panel, but only if nothing inside it has claimed the
   * focus already — the confirmation puts it on Cancel, and the entity form's
   * name field autofocuses. Effects run child-first, so both of those have
   * happened by the time this does; without the check it would undo them.
   */
  useEffect(() => {
    if (!open) return
    const node = panel.current
    if (node && !node.contains(document.activeElement)) node.focus()
  }, [open])

  if (!open) return null

  return (
    <div
      className="sb-modal-scrim"
      /*
       * Keydown is handled here rather than on window so that Escape stops at
       * the modal. The World's detail pane also listens for Escape to close
       * itself; without this, one press would answer the modal and dismantle
       * the thing behind it too.
       */
      onKeyDown={(event) => {
        if (event.key === 'Tab') {
          trapTab(event, panel.current)
          return
        }
        if (event.key !== 'Escape') return
        event.stopPropagation()
        if (!busy) onClose()
      }}
      /* Only the scrim itself — a click that started inside the panel and
         drifted out should not count as clicking away. */
      onClick={(event) => {
        if (!dismissOnScrim || busy) return
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panel}
        tabIndex={-1}
        className={`sb-modal${wide ? ' sb-modal--wide' : ''}`}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="sb-modal-head">
          {icon && <i className={icon} />}
          <h2 id={titleId}>{title}</h2>
          {showClose && (
            <button
              type="button"
              className="sb-modal-close"
              onClick={onClose}
              disabled={busy}
              aria-label="Close"
              title="Close"
            >
              <i className="ph ph-x" />
            </button>
          )}
        </div>

        {children}
      </div>
    </div>
  )
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Keeps Tab inside the panel: past the last control it wraps to the first,
 * and back past the first to the last. `aria-modal` tells a screen reader the
 * page behind is out of play; without this, the keyboard would not know it.
 */
function trapTab(event: React.KeyboardEvent, root: HTMLElement | null) {
  if (!root) return
  const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
  if (items.length === 0) {
    event.preventDefault()
    return
  }
  const first = items[0]!
  const last = items[items.length - 1]!
  const active = document.activeElement
  if (event.shiftKey && (active === first || active === root)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}
