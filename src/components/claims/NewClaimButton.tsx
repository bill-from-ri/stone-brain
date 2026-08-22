'use client'

import { useWorldSelection } from '@/components/world/WorldSelection'

/**
 * Opens the editor in the right pane.
 *
 * Still written to the URL — `?new=1` survives a reload — but through the
 * shared selection, so the pane opens on the click rather than on the server's
 * answer to it.
 */
export function NewClaimButton({ disabled }: { disabled: boolean }) {
  const { composing, toggleComposing } = useWorldSelection()
  const open = composing === 'claim'

  return (
    <button
      type="button"
      className={`btn ${open ? 'btn-secondary' : 'btn-primary'} sb-btn-sm`}
      onClick={() => toggleComposing('claim')}
      disabled={disabled}
      title={disabled ? 'Add an entity first' : undefined}
    >
      <i className={`ph-bold ${open ? 'ph-x' : 'ph-plus'}`} />
      {open ? 'Cancel' : 'New claim'}
    </button>
  )
}
