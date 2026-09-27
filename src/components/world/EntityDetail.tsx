import type { EntityRow, EntityTypeOption } from '@/db/queries/claims'
import { entityIcon } from '@/components/shared/entity-icon'
import { EntityActions } from './EntityActions'

/**
 * What the right pane says when an entity is selected but no claim is.
 *
 * Entities had no home anywhere in the product: the rail could filter by one
 * and the graph could centre on one, but nothing would tell you what it *was* —
 * its type, the spellings the matcher will accept for it, how much rests on it.
 * That is the gap this fills.
 *
 * Rename, merge and retype are still absent, deliberately: each rewrites the
 * claims underneath the entity, and they need their own endpoints and their own
 * confirmations rather than a pencil icon bolted onto a summary.
 *
 * Delete is here, though, because its absence was worse than its danger. An
 * entity typed by mistake — wrong type, wrong spelling, wrong thing entirely —
 * could not be removed from the product at all, which made the "New entity"
 * button a one-way door. It is guarded by the shared confirmation, which names
 * the claims the cascade will take with it.
 */
export function EntityDetail({
  entity,
  entityTypes,
  relationshipCount,
  onDeleted,
}: {
  entity: EntityRow
  entityTypes: EntityTypeOption[]
  /** Claims linking it to another entity, as opposed to attributes of it. */
  relationshipCount: number
  /** Clears the selection once the entity is gone. */
  onDeleted?: () => void
}) {
  const typeLabel = entityTypes.find((t) => t.name === entity.entityType)?.label ?? entity.entityType

  return (
    <>
      <div className="sb-detail-kicker">Entity</div>
      <div className="sb-detail-title sb-entity-title">
        <i className={entityIcon(entity.entityType)} />
        {entity.name}
      </div>
      <div className="sb-detail-meta">
        {typeLabel} · {entity.claimCount} {entity.claimCount === 1 ? 'claim' : 'claims'}
      </div>

      <div className="sb-detail-tags">
        <span className="tag tag-neutral">{entity.canonicity === 'canon' ? 'Canon' : 'Draft'}</span>
      </div>

      {/* The entity's one description — there is no `description` claim. Shown
          even when empty, so a missing summary reads as missing rather than as
          a card with nothing to say. */}
      {entity.summary ? (
        <p className="sb-entity-summary">{entity.summary}</p>
      ) : (
        <p className="sb-entity-summary sb-entity-summary-empty">No summary yet.</p>
      )}

      <div className="sb-tree-divider" style={{ margin: '16px 0' }} />

      <div className="sb-detail-kicker" style={{ marginBottom: 9 }}>
        Details
      </div>
      <dl className="sb-facts">
        <Fact label="Type" value={typeLabel} />
        <Fact label="Relationships" value={relationshipCount} />
        <Fact label="Attributes" value={entity.claimCount - relationshipCount} />
      </dl>

      <div className="sb-tree-divider" style={{ margin: '16px 0' }} />

      <div className="sb-detail-kicker" style={{ marginBottom: 9 }}>
        Also written as
      </div>
      {entity.nameVariants.length === 0 ? (
        <p className="sb-faint sb-claim-note">
          No alternate spellings. Extraction will only match this name.
        </p>
      ) : (
        <div className="sb-detail-tags">
          {entity.nameVariants.map((variant) => (
            <span key={variant} className="tag tag-outline">
              {variant}
            </span>
          ))}
        </div>
      )}

      <div className="sb-tree-divider" style={{ margin: '16px 0' }} />

      <EntityActions
        entityId={entity.id}
        entityName={entity.name}
        claimCount={entity.claimCount}
        onDeleted={onDeleted}
      />
    </>
  )
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="sb-fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
