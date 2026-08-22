'use client'

import type {
  EntityRow,
  EntityTypeOption,
  PredicateOption,
  SignatureRow,
} from '@/db/queries/claims'
import { Modal } from '@/components/shared/Modal'
import { ClaimEditor } from '@/components/claims/ClaimEditor'
import { EntityEditor } from './EntityEditor'
import { useWorldSelection } from './WorldSelection'

/**
 * Writing something new — a claim or an entity — in a modal over the World.
 *
 * Both editors used to open in the right-hand detail pane, which had two costs.
 * The pane is 320px and shared with everything else the screen can be about, so
 * a form could only ever grow narrower than it wants; and because the bar's
 * button was the only way to shut it, that button had to become `Cancel` while
 * the form was open, so the way to make a *second* claim was to read a button
 * that no longer said what it did.
 *
 * A modal fixes both. It is wide enough to grow into, it covers the bar so the
 * buttons underneath never have to change what they say, and it closes on its
 * own X, on Escape, or on saving.
 *
 * It does *not* close when you click the scrim: unlike a confirmation, this one
 * is holding something you typed.
 */
export function WorldComposer({
  entities,
  entityTypes,
  predicates,
  signatures,
}: {
  entities: EntityRow[]
  entityTypes: EntityTypeOption[]
  predicates: PredicateOption[]
  signatures: SignatureRow[]
}) {
  const { composing, toggleComposing, selectEntity } = useWorldSelection()

  const close = () => {
    if (composing) toggleComposing(composing)
  }

  const options = entities.map((e) => ({ id: e.id, name: e.name, entityType: e.entityType }))

  return (
    <Modal
      open={composing !== null}
      title={composing === 'entity' ? 'New entity' : 'New claim'}
      icon="ph-bold ph-plus"
      wide
      showClose
      dismissOnScrim={false}
      onClose={close}
    >
      {composing === 'entity' ? (
        <EntityEditor
          entities={options}
          entityTypes={entityTypes}
          /* Straight into the pane over what was just made: the entity is now
             the thing you are working on, and a form that clears itself and
             says nothing is no answer to "did that work?". `selectEntity`
             clears `composing`, which is what shuts this. */
          onCreated={selectEntity}
        />
      ) : composing === 'claim' ? (
        /* Closing on save is new, and it is the modal's doing: the pane left
           the form open so you could write another claim about the same
           subject, which worked because the table was visible beside it. Here
           the modal is over the table, so staying open would hide the one piece
           of evidence that the claim landed. */
        <ClaimEditor
          entities={options}
          entityTypes={entityTypes}
          predicates={predicates}
          signatures={signatures}
          onSaved={close}
        />
      ) : null}
    </Modal>
  )
}
