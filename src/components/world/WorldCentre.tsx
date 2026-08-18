'use client'

import type { ClaimRow, Graph } from '@/db/queries/claims'
import { ClaimsTable } from '@/components/claims/ClaimsTable'
import { NewClaimButton } from '@/components/claims/NewClaimButton'
import { PaneBarSpacer, RecordPane, useParamWriter } from '@/components/shared/RecordTable'
import { GraphView } from './GraphView'
import { ViewToggle, type WorldViewMode } from './ViewToggle'

/**
 * The centre of the World screen: one bar, two views of the same claims.
 *
 * The table and the graph were separate screens with separate rails and
 * separate selection. They are two renderings of one set of assertions, and the
 * question you bring to them — "what do we know about X?" — is the same, so
 * they share a rail, a selection, and this bar. The toggle only changes how the
 * answer is drawn.
 */
export function WorldCentre({
  view,
  claims,
  focusName,
  selectedClaimId,
  graph,
  activeEntityId,
  composing,
  canCreate,
}: {
  view: WorldViewMode
  claims: ClaimRow[]
  focusName: string | null
  selectedClaimId: string | null
  graph: Graph
  activeEntityId: string | null
  composing: boolean
  /**
   * Elements are deliberately not passed down from the page: a server-created
   * element handed to a client component as a prop trips React's key validation
   * when it lands inside a list, and plain props say more anyway.
   */
  canCreate: boolean
}) {
  const setParams = useParamWriter()

  const select = (entityId: string | null) =>
    setParams((p) => {
      if (entityId) p.set('entity', entityId)
      else p.delete('entity')
      p.delete('claim')
    })

  return (
    <RecordPane
      flush={view === 'graph'}
      bar={
        <>
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
            <button type="button" className="btn btn-secondary" onClick={() => select(null)}>
              Show all
            </button>
          )}
          <PaneBarSpacer />
          <NewClaimButton composing={composing} disabled={!canCreate} />
          <ViewToggle view={view} />
        </>
      }
    >
      {view === 'graph' ? (
        <GraphView graph={graph} activeEntityId={activeEntityId} onSelect={select} />
      ) : (
        <ClaimsTable claims={claims} selectedClaimId={selectedClaimId} />
      )}
    </RecordPane>
  )
}
