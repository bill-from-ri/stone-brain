'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'

/**
 * Deleting an entity, which is the most destructive thing this product can do.
 *
 * Both of `claims`' entity foreign keys are ON DELETE CASCADE, so this does not
 * remove one row — it removes the entity and every claim it is either end of,
 * with their sources. That is correct (a claim whose subject is gone is not a
 * claim about anything) and it is exactly why the confirmation names the count
 * rather than asking a bare "are you sure?". "Delete Ashfall and its 31 claims"
 * is a decision; "Delete?" is a reflex.
 *
 * The count comes from the row the pane is already drawn from, so the dialog
 * opens instantly and tells the truth about the same number shown above it.
 */
export function EntityActions({
  entityId,
  entityName,
  claimCount,
  onDeleted,
}: {
  entityId: string
  entityName: string
  /** Claims at either end of it — all of which the delete takes with it. */
  claimCount: number
  /** Clears the selection pointing at an entity that no longer exists. */
  onDeleted?: () => void
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const remove = async () => {
    setBusy(true)
    await fetch(`/api/entities/${entityId}`, { method: 'DELETE' })
    setBusy(false)
    setConfirming(false)
    // Order matters, as on a claim: drop the selection first so the pane is not
    // briefly rendering something deleted while the refreshed rail arrives.
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
        Delete entity
      </button>

      <ConfirmDialog
        open={confirming}
        title="Delete this entity?"
        confirmLabel="Delete entity"
        busy={busy}
        onConfirm={remove}
        onCancel={() => setConfirming(false)}
        body={
          <p>
            <strong>{entityName}</strong>
            {claimCount === 0
              ? ' will be removed from your world.'
              : ` and the ${claimCount} ${claimCount === 1 ? 'claim' : 'claims'} about it will be
                 removed from your world, along with the passages cited for them.`}
          </p>
        }
      />
    </>
  )
}
