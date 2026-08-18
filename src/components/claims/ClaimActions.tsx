'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/**
 * Delete, with the inverse offered rather than assumed.
 *
 * Removing the reverse direction is opt-in because it may have been asserted
 * independently or carry its own sources. Silently deleting a sourced claim as
 * a side effect of deleting a different one is exactly the kind of quiet loss
 * this project exists to prevent.
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
    // Order matters: drop the selection first, so the pane is not briefly
    // rendering a deleted claim while the refreshed table arrives.
    onDeleted?.()
    router.refresh()
  }

  if (!confirming) {
    return (
      <button
        type="button"
        className="btn btn-secondary sb-btn-sm"
        onClick={() => setConfirming(true)}
      >
        <i className="ph ph-trash" />
        Delete claim
      </button>
    )
  }

  return (
    <div className="sb-claim-confirm">
      <p className="sb-claim-note">Delete this claim?</p>
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
      <div className="sb-claim-confirm-row">
        <button type="button" className="btn btn-primary sb-btn-sm" onClick={remove} disabled={busy}>
          {busy ? 'Deleting…' : 'Delete'}
        </button>
        <button
          type="button"
          className="btn btn-secondary sb-btn-sm"
          onClick={() => setConfirming(false)}
        >
          Keep
        </button>
      </div>
    </div>
  )
}
