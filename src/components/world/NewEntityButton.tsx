'use client'

import { useWorldSelection } from './WorldSelection'

/**
 * Opens the entity editor.
 *
 * The sibling of NewClaimButton, and the reason that one can stop telling you
 * to "add an entity first" with no way in the product to do it. Styled
 * identically, because they are the same kind of thing: the two nouns this
 * screen can create, offered side by side.
 *
 * It does not become `Cancel` while the form is open. The form is a modal over
 * the whole screen, so this button is not visible to be misread, and there is
 * no state in which it says something it will not do.
 */
export function NewEntityButton() {
  const { toggleComposing } = useWorldSelection()

  return (
    <button
      type="button"
      className="btn btn-primary sb-btn-sm"
      onClick={() => toggleComposing('entity')}
    >
      <i className="ph-bold ph-plus" />
      New entity
    </button>
  )
}
