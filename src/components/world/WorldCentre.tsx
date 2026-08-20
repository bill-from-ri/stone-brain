'use client'

import type { ClaimRow, EntityRow, Graph } from '@/db/queries/claims'
import { ClaimsTable } from '@/components/claims/ClaimsTable'
import { NewClaimButton } from '@/components/claims/NewClaimButton'
import { PaneBarSpacer, RecordPane } from '@/components/shared/RecordTable'
import { GraphView } from './GraphView'
import { ViewToggle, type WorldViewMode } from './ViewToggle'
import { useWorldSelection } from './WorldSelection'

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
  entities,
  graph,
  canCreate,
}: {
  view: WorldViewMode
  claims: ClaimRow[]
  /** The rail's entities, so the focused one can be named without a query. */
  entities: EntityRow[]
  graph: Graph
  /**
   * Elements are deliberately not passed down from the page: a server-created
   * element handed to a client component as a prop trips React's key validation
   * when it lands inside a list, and plain props say more anyway.
   */
  canCreate: boolean
}) {
  const { entityId, inspecting, selectEntity, toggleInspecting } = useWorldSelection()

  const focusName = entityId ? (entities.find((e) => e.id === entityId)?.name ?? null) : null

  /*
   * Choosing an entity re-filters the claims underneath, which only the server
   * can do, so this pane — unlike the rail and the detail pane beside it — does
   * still wait on a round trip. It is deliberately left alone while that lands:
   * the rows stay at full strength and stay clickable, and the new ones swap in
   * when they arrive. Nothing here should react to a pane opening beside it.
   */
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
            <>
              {/* The way back to an entity's pane once it has been closed —
                  the rail cannot do it, since clicking the active entry there
                  clears the filter. */}
              <button
                type="button"
                className="btn btn-secondary"
                aria-pressed={inspecting}
                onClick={toggleInspecting}
              >
                {inspecting ? 'Hide details' : 'Details'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => selectEntity(null)}>
                Show all
              </button>
            </>
          )}
          <PaneBarSpacer />
          <NewClaimButton disabled={!canCreate} />
          <ViewToggle view={view} />
        </>
      }
    >
      {view === 'graph' ? (
        <GraphView graph={graph} activeEntityId={entityId} onSelect={selectEntity} />
      ) : (
        <ClaimsTable claims={claims} />
      )}
    </RecordPane>
  )
}
