'use client'

import type { ClaimRow } from '@/db/queries/claims'
import { EmptyState, RecordTable, type Column } from '@/components/shared/RecordTable'
import { predicateText } from '@/components/shared/predicate'
import { useWorldSelection } from '@/components/world/WorldSelection'

/**
 * The claim table, from the prototype (lines 467-483).
 *
 * Its three-column spine — entity, relationship, entity — is kept exactly,
 * because it is what makes a claim readable as a sentence. The prototype's
 * checkbox and confidence columns are dropped: both belong to reviewing an
 * extraction run, which does not exist until Phase 2B.
 *
 * Attribute claims reuse the object column for their value, with the value type
 * in the faint position where a relationship shows the object's entity type.
 * They are the same shape of statement and splitting them into two tables would
 * only make the page harder to read.
 *
 * The frame around it — pane, bar, view toggle — belongs to WorldCentre; the
 * table itself is the Library's, via RecordTable.
 *
 * Both entity columns name something the rail can also select, so they select
 * it: reading "Acme employs Rowan" and wanting Rowan's claims should not mean
 * finding Rowan again in a rail of hundreds. The name is the link and the rest
 * of the row still opens the claim, which is why EntityName stops the click
 * from reaching the row underneath.
 */
export function ClaimsTable({ claims }: { claims: ClaimRow[] }) {
  const { claimId, selectClaim, selectEntity } = useWorldSelection()

  const columns: Column<ClaimRow>[] = [
    {
      key: 'subject',
      header: 'Entity',
      cell: (claim) => (
        <>
          <EntityName id={claim.subjectId} name={claim.subjectName} onSelect={selectEntity} />{' '}
          <span className="sb-claim-type">{claim.subjectType}</span>
        </>
      ),
    },
    {
      key: 'predicate',
      header: 'Relationship',
      cell: (claim) => (
        <span className="sb-claim-predicate">{predicateText(claim.predicateLabel)}</span>
      ),
    },
    {
      key: 'object',
      header: 'Entity or value',
      cell: (claim) =>
        claim.objectName ? (
          <>
            <EntityName id={claim.objectId} name={claim.objectName} onSelect={selectEntity} />{' '}
            <span className="sb-claim-type">{claim.objectType}</span>
          </>
        ) : (
          <>
            {claim.value} <span className="sb-claim-type">{claim.valueType}</span>
          </>
        ),
    },
    {
      key: 'when',
      header: 'When',
      width: 90,
      cell: (claim) => <Faded value={whenOf(claim)} />,
    },
    {
      key: 'sources',
      header: 'Sources',
      width: 74,
      align: 'right',
      cell: (claim) => <Faded value={claim.sourceCount === 0 ? '—' : String(claim.sourceCount)} />,
    },
  ]

  return (
    <RecordTable
      dense
      columns={columns}
      rows={claims}
      rowKey={(claim) => claim.id}
      selectedKey={claimId}
      onSelect={(claim) => selectClaim(claim.id)}
      empty={
        <EmptyState
          title="No claims yet."
          note="Add one by hand, or wait for extraction in Phase 2."
        />
      }
    />
  )
}

/**
 * An entity name that filters the table to it.
 *
 * A button rather than a link, because the selection it makes is the same one
 * the rail makes — client state first, with the URL catching up — and a real
 * anchor here would navigate instead, which is the round trip WorldSelection
 * exists to avoid.
 */
function EntityName({
  id,
  name,
  onSelect,
}: {
  id: string | null
  name: string
  onSelect: (id: string) => void
}) {
  if (!id) return <>{name}</>

  return (
    <button
      type="button"
      className="sb-entity-link"
      onClick={(event) => {
        // Otherwise the row handler runs too and opens the claim over the
        // entity we just asked for.
        event.stopPropagation()
        onSelect(id)
      }}
    >
      {name}
    </button>
  )
}

/** The prototype greys a real value and fades an absent one. */
function Faded({ value }: { value: string }) {
  return <span className={value === '—' ? 'sb-cell-faint' : 'sb-cell-muted'}>{value}</span>
}

/**
 * The in-world validity window, or the date an attribute names.
 *
 * Labels are shown verbatim; the sort key behind them is never displayed,
 * because "200" is not something anyone wrote about their world.
 */
function whenOf(claim: ClaimRow): string {
  if (claim.startTime || claim.endTime) {
    return [claim.startTime ?? '…', claim.endTime ?? '…'].join(' – ')
  }
  if (claim.valueType === 'date' && claim.value) return claim.value
  return '—'
}
