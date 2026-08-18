import type {
  ClaimRow,
  ClaimSourceRow,
  EntityRow,
  EntityTypeOption,
  PredicateOption,
  SignatureRow,
} from '@/db/queries/claims'
import { DetailPaneShell } from '@/components/shared/DetailPaneShell'
import { ClaimDetail } from '@/components/claims/ClaimDetail'
import { ClaimEditor } from '@/components/claims/ClaimEditor'
import { EntityDetail } from './EntityDetail'

/**
 * The right pane, and the one place that decides what it is about.
 *
 * Precedence runs from the most specific thing you have picked to the least:
 * a claim you clicked, else the entity you are looking through, else nothing —
 * in which case the pane closes and the table takes the width, the same rule
 * the Library follows.
 */
export function WorldDetail({
  claim,
  sources,
  entity,
  relationshipCount,
  composing,
  entities,
  entityTypes,
  predicates,
  signatures,
}: {
  claim: ClaimRow | null
  sources: ClaimSourceRow[]
  entity: EntityRow | null
  relationshipCount: number
  composing: boolean
  entities: { id: string; name: string; entityType: string }[]
  entityTypes: EntityTypeOption[]
  predicates: PredicateOption[]
  signatures: SignatureRow[]
}) {
  const body = composing ? (
    <ClaimEditor
      entities={entities}
      entityTypes={entityTypes}
      predicates={predicates}
      signatures={signatures}
    />
  ) : claim ? (
    <ClaimDetail claim={claim} sources={sources} />
  ) : entity ? (
    <EntityDetail
      entity={entity}
      entityTypes={entityTypes}
      relationshipCount={relationshipCount}
    />
  ) : null

  /*
   * Closing undoes whatever the pane is currently about. Over a claim that is
   * the claim, which drops you back to the entity you were reading; over an
   * entity there is nothing narrower to fall back to, so it clears the entity
   * itself rather than leaving a button that visibly does nothing.
   */
  const clears = composing || claim ? ['claim', 'new'] : ['entity', 'claim', 'new']

  return (
    <DetailPaneShell open={body !== null} clears={clears} width={320}>
      {body}
    </DetailPaneShell>
  )
}
