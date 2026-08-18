'use client'

import type { ClaimRow } from '@/db/queries/claims'
import { EmptyState, RecordTable, useParamWriter, type Column } from '@/components/shared/RecordTable'
import { predicateText } from '@/components/shared/predicate'

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
 */
export function ClaimsTable({
  claims,
  selectedClaimId,
}: {
  claims: ClaimRow[]
  selectedClaimId: string | null
}) {
  const setParams = useParamWriter()

  const columns: Column<ClaimRow>[] = [
    {
      key: 'subject',
      header: 'Entity',
      cell: (claim) => (
        <>
          {claim.subjectName} <span className="sb-claim-type">{claim.subjectType}</span>
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
            {claim.objectName} <span className="sb-claim-type">{claim.objectType}</span>
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
      selectedKey={selectedClaimId}
      onSelect={(claim) =>
        setParams((p) => {
          p.set('claim', claim.id)
          p.delete('new')
        })
      }
      empty={
        <EmptyState
          title="No claims yet."
          note="Add one by hand, or wait for extraction in Phase 2."
        />
      }
    />
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
