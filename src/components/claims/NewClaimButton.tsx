'use client'

import { useWorldSelection } from '@/components/world/WorldSelection'

/**
 * Opens the claim editor.
 *
 * Still written to the URL — `?new=claim` survives a reload — but through the
 * shared selection, so the editor opens on the click rather than on the
 * server's answer to it.
 *
 * Like its sibling NewEntityButton, it keeps its label while the form is open:
 * the editor is a modal covering this bar, so there is nothing here to cancel
 * from and nothing to relabel.
 */
export function NewClaimButton({ disabled }: { disabled: boolean }) {
  const { toggleComposing } = useWorldSelection()

  return (
    <button
      type="button"
      className="btn btn-primary sb-btn-sm"
      onClick={() => toggleComposing('claim')}
      disabled={disabled}
      title={disabled ? 'Add an entity first' : undefined}
    >
      <i className="ph-bold ph-plus" />
      New claim
    </button>
  )
}
