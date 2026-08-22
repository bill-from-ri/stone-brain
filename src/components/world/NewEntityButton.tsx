'use client'

import { useWorldSelection } from './WorldSelection'

/**
 * Opens the entity editor in the right pane.
 *
 * The sibling of NewClaimButton, and the reason it can stop being disabled on
 * an empty world: `New claim` has always had to tell you to "add an entity
 * first", with no way in the product to do that. This is the way.
 *
 * Secondary next to the claim's primary, because a claim is the thing this
 * screen is for and an entity is the noun you need before you can write one.
 */
export function NewEntityButton() {
  const { composing, toggleComposing } = useWorldSelection()
  const open = composing === 'entity'

  return (
    <button
      type="button"
      className="btn btn-secondary sb-btn-sm"
      onClick={() => toggleComposing('entity')}
      aria-pressed={open}
    >
      <i className={`ph-bold ${open ? 'ph-x' : 'ph-plus'}`} />
      {open ? 'Cancel' : 'New entity'}
    </button>
  )
}
