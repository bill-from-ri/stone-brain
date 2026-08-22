'use client'

import { useEffect, useRef } from 'react'
import { Modal } from './Modal'

/**
 * The one modal for "this cannot be undone".
 *
 * Destructive actions were confirmed inline before — the delete button swapped
 * itself for a small "Delete this claim? / Keep" row inside the pane. That is
 * dismissable by looking away: it sits at the same weight as the rest of the
 * pane, it can be scrolled off screen, and it says nothing about the fact that
 * there is no undo anywhere in this product. Deleting an entity takes its
 * claims with it through the cascade, which is far too much to lose to a
 * mis-click on a button that looks like every other button.
 *
 * So one dialog, shared: it takes the focus, it names what will be lost, it
 * always says that the loss is permanent, and it has to be answered before
 * anything else can happen. Callers supply the sentence and may put extra
 * controls in `children` — the claim's "also delete the inverse" checkbox is
 * a choice *about* the deletion and belongs inside the decision, not before it.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  busy = false,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean
  title: string
  /** What will be lost, in a sentence. The irreversibility is added below. */
  body: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
  /** Extra controls that belong to the decision, shown above the buttons. */
  children?: React.ReactNode
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  /*
   * Focus lands on Cancel, not Confirm. A dialog that appears under a cursor
   * already travelling toward a button should not have the destructive answer
   * one Enter away — the safe answer is the one worth making easy.
   */
  useEffect(() => {
    if (open) cancelRef.current?.focus()
  }, [open])

  return (
    <Modal
      open={open}
      title={title}
      icon="ph-bold ph-warning"
      role="alertdialog"
      busy={busy}
      onClose={onCancel}
    >
      <div className="sb-modal-body">
        {body}
        {/* Said by the dialog rather than by each caller, so no destructive
            action can ship without it. */}
        <p className="sb-modal-warning">This cannot be undone.</p>
      </div>

      {children && <div className="sb-modal-extra">{children}</div>}

      <div className="sb-modal-actions">
        <button
          ref={cancelRef}
          type="button"
          className="btn btn-secondary sb-btn-sm"
          onClick={onCancel}
          disabled={busy}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className="btn sb-btn-sm sb-btn-danger"
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? 'Deleting…' : confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
