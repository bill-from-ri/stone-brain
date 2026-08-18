import type { EntityRow, EntityTypeOption } from '@/db/queries/claims'
import { entityIcon } from '@/components/shared/entity-icon'

/**
 * What the right pane says when an entity is selected but no claim is.
 *
 * Entities had no home anywhere in the product: the rail could filter by one
 * and the graph could centre on one, but nothing would tell you what it *was* —
 * its type, the spellings the matcher will accept for it, how much rests on it.
 * That is the gap this fills.
 *
 * Read-only for now, deliberately. Rename, merge and retype are the operations
 * that actually repair a mismatched entity, and each rewrites claims underneath
 * it; they need their own endpoints and their own confirmations rather than a
 * pencil icon bolted onto a summary.
 */
export function EntityDetail({
  entity,
  entityTypes,
  relationshipCount,
}: {
  entity: EntityRow
  entityTypes: EntityTypeOption[]
  /** Claims linking it to another entity, as opposed to attributes of it. */
  relationshipCount: number
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

      {entity.summary && <p className="sb-entity-summary">{entity.summary}</p>}

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
