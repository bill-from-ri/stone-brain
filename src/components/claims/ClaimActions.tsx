'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type {
  ClaimRow,
  EntityTypeOption,
  PredicateOption,
  SignatureRow,
} from '@/db/queries/claims'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Modal } from '@/components/shared/Modal'
import { ClaimEditor } from './ClaimEditor'

/** What `GET /api/claims/[id]/edit` returns: the claim, and the pickers' choices. */
type EditOptions = {
  claim: ClaimRow
  entities: { id: string; name: string; entityType: string }[]
  entityTypes: EntityTypeOption[]
  predicates: PredicateOption[]
  signatures: SignatureRow[]
}

/**
 * Edit and delete, for one claim.
 *
 * Both act on the claim *and* its reverse direction. That used to be a
 * checkbox on delete, on the theory that the inverse might be an independent
 * fact; it is not — it is the same fact read from the other end — and a graph
 * that keeps "Ashfall is ruled by Sera" after "Sera rules Ashfall" was deleted
 * contradicts itself. So it is no longer asked, only said: the dialog names
 * the second claim that goes with the first.
 *
 * The confirmation is the shared ConfirmDialog, the same one guarding entity
 * deletion — a modal that takes the focus and says outright that there is no
 * undo. Two different weights of warning for two irreversible deletions taught
 * the wrong lesson about which one to read.
 *
 * Editing opens the claim editor in a modal, filled in. The editor's pickers
 * need the entity list and the ontology, which the pane does not carry, so
 * they are fetched when Edit is pressed rather than with every selection.
 */
export function ClaimActions({
  claimId,
  hasInverse,
  claim,
  onDeleted,
  onEdited,
}: {
  claimId: string
  hasInverse: boolean
  /** When given, the delete dialog names the inverse rather than describing it. */
  claim?: ClaimRow
  /** Clears the selection pointing at a claim that no longer exists. */
  onDeleted?: () => void
  /** The claim as an edit left it, for a pane drawn from a row that is now stale. */
  onEdited?: (claim: ClaimRow) => void
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const [editing, setEditing] = useState<EditOptions | null>(null)
  const [loadingEdit, setLoadingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const remove = async () => {
    setBusy(true)
    await fetch(`/api/claims/${claimId}`, { method: 'DELETE' })
    setBusy(false)
    setConfirming(false)
    // Order matters: drop the selection first, so the pane is not briefly
    // rendering a deleted claim while the refreshed table arrives.
    onDeleted?.()
    router.refresh()
  }

  const openEditor = async () => {
    setEditError(null)
    setLoadingEdit(true)
    const res = await fetch(`/api/claims/${claimId}/edit`)
    const body = (await res.json().catch(() => null)) as
      | ({ ok: true } & EditOptions)
      | { ok: false; error?: string }
      | null
    setLoadingEdit(false)

    if (!body?.ok) {
      setEditError(body?.error ?? 'Could not open that claim for editing.')
      return
    }
    setEditing(body)
  }

  const inverseText =
    claim?.inverseName && claim.objectName
      ? `${claim.objectName} — ${claim.inverseName} → ${claim.subjectName}`
      : null

  return (
    <>
      <div className="sb-field-row">
        <button
          type="button"
          className="btn btn-secondary sb-btn-sm"
          onClick={openEditor}
          disabled={loadingEdit}
        >
          <i className="ph ph-pencil-simple" />
          {loadingEdit ? 'Opening…' : 'Edit claim'}
        </button>

        <button
          type="button"
          className="btn btn-secondary sb-btn-sm"
          onClick={() => setConfirming(true)}
        >
          <i className="ph ph-trash" />
          Delete claim
        </button>
      </div>

      {editError && <p className="sb-form-error">{editError}</p>}

      {/* Same frame as the new-claim composer: it holds typed edits, so a
          stray click on the scrim must not discard them. */}
      <Modal
        open={editing !== null}
        title="Edit claim"
        icon="ph ph-pencil-simple"
        wide
        showClose
        dismissOnScrim={false}
        onClose={() => setEditing(null)}
      >
        {editing && (
          <ClaimEditor
            entities={editing.entities}
            entityTypes={editing.entityTypes}
            predicates={editing.predicates}
            signatures={editing.signatures}
            editing={editing.claim}
            onSaved={(saved) => {
              setEditing(null)
              if (saved) onEdited?.(saved)
            }}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={confirming}
        title="Delete this claim?"
        confirmLabel="Delete claim"
        busy={busy}
        onConfirm={remove}
        onCancel={() => setConfirming(false)}
        body={
          <p>
            {hasInverse
              ? 'This claim, its reverse direction, and any passages cited for them will be removed from your world.'
              : 'This claim and any passages cited for it will be removed from your world.'}
          </p>
        }
      >
        {hasInverse && inverseText && (
          <div className="sb-inverse-note">
            <span className="sb-check">Also deletes:</span>
            <code className="sb-inverse-preview">{inverseText}</code>
          </div>
        )}
      </ConfirmDialog>
    </>
  )
}
