'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import type { Route } from 'next'
import type { ClaimRow, EntityRow, Graph } from '@/db/queries/claims'
import { ClaimsTable } from '@/components/claims/ClaimsTable'
import { NewClaimButton } from '@/components/claims/NewClaimButton'
import { NewEntityButton } from './NewEntityButton'
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
  document,
  canCreateClaim,
}: {
  view: WorldViewMode
  claims: ClaimRow[]
  /** The rail's entities, so the focused one can be named without a query. */
  entities: EntityRow[]
  graph: Graph
  /**
   * The `?document=` filter, if one is active. `name` is null for an id that
   * names no document of yours — the filter still applies, to nothing, so the
   * bar still has to say it is there and offer the way out.
   */
  document: DocumentFilter | null
  /**
   * Whether there is anything to make a claim *about*. Only the claim button
   * is gated on it — `New entity` is the way out of an empty world, so gating
   * that one on the world being non-empty would close the only door.
   *
   * Elements are deliberately not passed down from the page: a server-created
   * element handed to a client component as a prop trips React's key validation
   * when it lands inside a list, and plain props say more anyway.
   */
  canCreateClaim: boolean
}) {
  const { entityId, inspecting, selectEntity, toggleInspecting } = useWorldSelection()

  const focusName = entityId ? (entities.find((e) => e.id === entityId)?.name ?? null) : null
  const clearDocument = useHrefWithout('document')

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
            {document && (
              <>
                {' from '}
                <strong>{document.name ?? 'an unknown document'}</strong>
                {document.removed && ' (no longer in the Library)'}
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
                {document ? 'All entities' : 'Show all'}
              </button>
            </>
          )}
          {document && (
            // A link, not selection state: the document filter is read only
            // by the server, so widening it is a navigation either way. It
            // keeps everything else in the URL — the entity, the open claim,
            // the view — so it undoes exactly the one thing it names.
            <Link className="btn btn-secondary" href={clearDocument} replace scroll={false}>
              All documents
            </Link>
          )}
          <PaneBarSpacer />
          <NewEntityButton />
          <NewClaimButton disabled={!canCreateClaim} />
          <ViewToggle view={view} />
        </>
      }
    >
      {view === 'graph' ? (
        <GraphView graph={graph} activeEntityId={entityId} onSelect={selectEntity} />
      ) : (
        <ClaimsTable claims={claims} filtered={Boolean(entityId || document)} />
      )}
    </RecordPane>
  )
}

export type DocumentFilter = { id: string; name: string | null; removed: boolean }

/** The current URL with one query parameter removed. */
function useHrefWithout(key: string): Route {
  const pathname = usePathname()
  const query = new URLSearchParams(useSearchParams())
  query.delete(key)
  const qs = query.toString()
  return (qs ? `${pathname}?${qs}` : pathname) as Route
}
