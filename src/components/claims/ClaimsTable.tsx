'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { Route } from 'next'
import type { ClaimRow } from '@/db/queries/claims'

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
 */
export function ClaimsTable({
  claims,
  focusName,
  selectedClaimId,
}: {
  claims: ClaimRow[]
  focusName: string | null
  selectedClaimId: string | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const setParam = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params)
    mutate(next)
    router.replace(`${pathname}?${next}` as Route, { scroll: false })
  }

  return (
    <div className="sb-claims-centre">
      <div className="sb-claims-bar">
        <div className="sb-claims-count">
          {claims.length} {claims.length === 1 ? 'claim' : 'claims'}
          {focusName && (
            <>
              {' about '}
              <strong>{focusName}</strong>
            </>
          )}
        </div>
        {focusName && (
          <button
            type="button"
            className="btn btn-secondary sb-btn-sm"
            onClick={() =>
              setParam((p) => {
                p.delete('entity')
                p.delete('claim')
              })
            }
          >
            Show all
          </button>
        )}
      </div>

      <div className="sb-claims-table-wrap">
        {claims.length === 0 ? (
          <div className="sb-empty">
            <p>No claims yet.</p>
            <p className="sb-faint">
              Add one by hand, or wait for extraction in Phase 2.
            </p>
          </div>
        ) : (
          <table className="table sb-claim-table">
            <thead>
              <tr>
                <th>Entity</th>
                <th>Relationship</th>
                <th>Entity or value</th>
                <th style={{ width: 90 }}>When</th>
                <th style={{ width: 74, textAlign: 'right' }}>Sources</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((claim) => (
                <tr
                  key={claim.id}
                  onClick={() => setParam((p) => {
                    p.set('claim', claim.id)
                    p.delete('new')
                  })}
                  className={claim.id === selectedClaimId ? 'sb-row--on' : undefined}
                >
                  <td>
                    <span className="sb-claim-entity">{claim.subjectName}</span>{' '}
                    <span className="sb-claim-type">{claim.subjectType}</span>
                  </td>
                  <td className="sb-claim-predicate">{claim.predicate}</td>
                  <td>
                    {claim.objectName ? (
                      <>
                        <span className="sb-claim-entity">{claim.objectName}</span>{' '}
                        <span className="sb-claim-type">{claim.objectType}</span>
                      </>
                    ) : (
                      <>
                        <span className="sb-claim-value">{claim.value}</span>{' '}
                        <span className="sb-claim-type">{claim.valueType}</span>
                      </>
                    )}
                  </td>
                  <td className="sb-cell-faint">{whenOf(claim)}</td>
                  <td className="sb-cell-faint" style={{ textAlign: 'right' }}>
                    {claim.sourceCount === 0 ? '—' : claim.sourceCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
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
