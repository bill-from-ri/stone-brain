'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type {
  ClaimRow,
  EntityTypeOption,
  PredicateOption,
  SignatureRow,
} from '@/db/queries/claims'
import { ClaimEditor } from '@/components/claims/ClaimEditor'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Modal } from '@/components/shared/Modal'

/**
 * Every button on the Conflicts screen that changes something.
 *
 * Each one names a conflict by id and lets the server work out what that
 * means against the graph as it is now (see /api/conflicts/resolve) — nothing
 * here sends a list of claims to delete. On success the page is refreshed
 * rather than patched locally: the conflict list is derived, and a resolved
 * conflict disappearing is something only a re-derivation can say for sure.
 */

type Outcome = { ok: true } | { ok: false; error: string }

async function send(url: string, method: 'POST' | 'DELETE', body: object): Promise<Outcome> {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null)
  const json = (await res?.json().catch(() => null)) as { ok?: boolean; error?: string } | null
  return json?.ok ? { ok: true } : { ok: false, error: json?.error ?? 'Something went wrong. Try again.' }
}

/** busy / error / run, shared by every action below. */
function useAction() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (request: () => Promise<Outcome>, after?: () => void) => {
    setBusy(true)
    setError(null)
    const outcome = await request()
    setBusy(false)
    if (!outcome.ok) {
      setError(outcome.error)
      return
    }
    after?.()
    router.refresh()
  }

  return { busy, error, run }
}

/**
 * "Keep this one" — deletes the claims that disagree with this side.
 *
 * Destructive, so it confirms, and the confirmation lists exactly what will
 * go: the same `displaces` list the server will act on, read from the same
 * derivation.
 */
export function KeepSideButton({
  conflictId,
  claimId,
  answer,
  displaced,
}: {
  conflictId: string
  /** Any claim on the side; the server finds the side from it. */
  claimId: string
  answer: string
  /** What will be deleted, as the user would read it. */
  displaced: string[]
}) {
  const [confirming, setConfirming] = useState(false)
  const { busy, error, run } = useAction()

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setConfirming(true)}>
        <i className="ph ph-check" />
        Keep this one
      </button>

      <ConfirmDialog
        open={confirming}
        title={`Keep “${answer}”?`}
        confirmLabel="Keep this one"
        busy={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={() =>
          run(
            () => send('/api/conflicts/resolve', 'POST', { action: 'keep', conflictId, claimId }),
            () => setConfirming(false),
          )
        }
        body={
          <>
            <p>
              {displaced.length === 1
                ? 'This deletes the claim that disagrees with it'
                : `This deletes the ${displaced.length} claims that disagree with it`}
              , each with its reverse direction and the passages cited for it:
            </p>
            <ul className="sb-cf-list-plain">
              {displaced.map((text, i) => (
                <li key={i}>{text}</li>
              ))}
            </ul>
          </>
        }
      >
        {error && <p className="sb-cf-error">{error}</p>}
      </ConfirmDialog>
    </>
  )
}

/** "Delete claim" for a claim whose sources have all vanished. */
export function DeleteUnsourcedButton({
  conflictId,
  sentence,
  hasReverse,
}: {
  conflictId: string
  sentence: string
  /** A relationship's reverse direction is always deleted with it; an attribute has none. */
  hasReverse: boolean
}) {
  const [confirming, setConfirming] = useState(false)
  const { busy, error, run } = useAction()

  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={() => setConfirming(true)}>
        <i className="ph ph-trash" />
        Delete claim
      </button>

      <ConfirmDialog
        open={confirming}
        title="Delete this claim?"
        confirmLabel="Delete claim"
        busy={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={() =>
          run(
            () => send('/api/conflicts/resolve', 'POST', { action: 'delete', conflictId }),
            () => setConfirming(false),
          )
        }
        body={
          <p>
            “{sentence}”{hasReverse ? ' and its reverse direction' : ''} will be removed from your
            world, along with the passages kept for {hasReverse ? 'them' : 'it'}.
          </p>
        }
      >
        {error && <p className="sb-cf-error">{error}</p>}
      </ConfirmDialog>
    </>
  )
}

/**
 * "Not a conflict" / "Keep it as it stands", and its undo.
 *
 * Not confirmed: a dismissal deletes nothing and is one click to take back,
 * from the Dismissed list the page links to.
 */
export function DismissButton({
  conflictId,
  dismissed,
  label,
}: {
  conflictId: string
  dismissed: boolean
  label: string
}) {
  const { busy, error, run } = useAction()

  return (
    <>
      <button
        type="button"
        className={dismissed ? 'btn btn-secondary' : 'btn btn-ghost'}
        disabled={busy}
        onClick={() =>
          run(() => send('/api/conflicts/dismissals', dismissed ? 'DELETE' : 'POST', { conflictId }))
        }
      >
        {dismissed ? <i className="ph ph-arrow-counter-clockwise" /> : <i className="ph ph-eye-slash" />}
        {busy ? 'Saving…' : label}
      </button>
      {error && <span className="sb-cf-error">{error}</span>}
    </>
  )
}

/**
 * Edit one side's claim — its object or value, and its dates.
 *
 * The World's own claim editor, opened on this claim. Adding the dates that
 * make two rulers a succession is the commonest honest fix for a conflict, and
 * it is an ordinary claim edit: the conflict needs nothing of its own to be
 * resolved by it, and disappears on the refresh if the dates now separate.
 */
export function EditClaimButton({
  claim,
  entities,
  entityTypes,
  predicates,
  signatures,
}: {
  claim: ClaimRow
  entities: { id: string; name: string; entityType: string }[]
  entityTypes: EntityTypeOption[]
  predicates: PredicateOption[]
  signatures: SignatureRow[]
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
        <i className="ph ph-pencil-simple" />
        Edit
      </button>

      <Modal
        open={open}
        title="Edit claim"
        icon="ph-bold ph-pencil-simple"
        wide
        showClose
        dismissOnScrim={false}
        onClose={() => setOpen(false)}
      >
        {/* Mounted only while open, so it starts from the claim as it is now
            rather than from whatever was typed and abandoned last time. */}
        {open && (
          <ClaimEditor
            entities={entities}
            entityTypes={entityTypes}
            predicates={predicates}
            signatures={signatures}
            editing={claim}
            onSaved={() => setOpen(false)}
          />
        )}
      </Modal>
    </>
  )
}
