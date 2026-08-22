'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'

/**
 * Delete, with the inverse offered rather than assumed.
 *
 * Removing the reverse direction is opt-in because it may have been asserted
 * independently or carry its own sources. Silently deleting a sourced claim as
 * a side effect of deleting a different one is exactly the kind of quiet loss
 * this project exists to prevent.
 *
 * The confirmation used to be an inline "Delete this claim? / Keep" row that
 * replaced the button. It now uses the shared ConfirmDialog, the same one
 * guarding entity deletion — a modal that takes the focus and says outright
 * that there is no undo. Two different weights of warning for two irreversible
 * deletions taught the wrong lesson about which one to read. The inverse
 * checkbox moves inside it, where it belongs: it is a choice about the
 * deletion, so it should be answered as part of agreeing to it.
 */
export function ClaimActions({
  claimId,
  hasInverse,
  onDeleted,
}: {
  claimId: string
  hasInverse: boolean
  /** Clears the selection pointing at a claim that no longer exists. */
  onDeleted?: () => void
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [alsoInverse, setAlsoInverse] = useState(true)
  const [busy, setBusy] = useState(false)

  const remove = async () => {
    setBusy(true)
    await fetch(`/api/claims/${claimId}?inverse=${hasInverse && alsoInverse ? '1' : '0'}`, {
      method: 'DELETE',
    })
    setBusy(false)
    setConfirming(false)
    // Order matters: drop the selection first, so the pane is not briefly
    // rendering a deleted claim while the refreshed table arrives.
    onDeleted?.()
    router.refresh()
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-secondary sb-btn-sm"
        onClick={() => setConfirming(true)}
      >
        <i className="ph ph-trash" />
        Delete claim
      </button>

      <ConfirmDialog
        open={confirming}
        title="Delete this claim?"
        confirmLabel="Delete claim"
        busy={busy}
        onConfirm={remove}
        onCancel={() => setConfirming(false)}
        body={
          <p>
            This claim and any passages cited for it will be removed from your world.
          </p>
        }
      >
        {hasInverse && (
          <label className="sb-check">
            <input
              type="checkbox"
              checked={alsoInverse}
              onChange={(e) => setAlsoInverse(e.target.checked)}
            />
            Also delete the reverse direction
          </label>
        )}
      </ConfirmDialog>
    </>
  )
}
