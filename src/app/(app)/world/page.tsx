import { AppHeader } from '@/components/shell/AppHeader'
import { EntityFilter } from '@/components/claims/EntityFilter'
import { WorldCentre } from '@/components/world/WorldCentre'
import { WorldDetail } from '@/components/world/WorldDetail'
import { WorldSelectionProvider } from '@/components/world/WorldSelection'
import type { WorldViewMode } from '@/components/world/ViewToggle'
import {
  getClaims,
  getEntities,
  getEntityTypeCounts,
  getEntityTypes,
  getGraph,
  getPredicates,
  getSignatures,
} from '@/db/queries/claims'
import { requireReady } from '@/lib/auth/guard'

export const dynamic = 'force-dynamic'

/**
 * The World: your entities, everything asserted about them, and the shape they
 * make together. It replaces the separate Claims and Graph screens.
 *
 * They were one screen already and did not know it — the same entity rail, the
 * same claims underneath, differing only in whether the answer came out as rows
 * or as a picture. Keeping them apart meant two selections that could disagree
 * and two routes for the same question. Here the rail, the entity in `?entity=`
 * and the claim in `?claim=` are shared, and `?view=` only chooses the drawing.
 *
 * The prototype framed its CLAIMS view as *one extraction run awaiting commit* —
 * a progress bar of new / already-in-graph / contradicting, a checkbox per row,
 * a "Commit to graph" footer. None of that exists yet: there is no extraction
 * (Phase 2B) and no contradiction detection (Phase 3). What is kept is the part
 * that was always right, over the whole graph rather than one document's output.
 *
 * ---
 *
 * On what this page does and does not fetch.
 *
 * It used to resolve the selection here too: `getEntity` for the focused
 * entity, then `getClaim`, then `getClaimSources`, each awaited after the
 * others. Over Neon's HTTP driver that was three further round trips stacked on
 * top of the batch below, and all three ran on every navigation — including the
 * ones that only opened a pane over data the browser was already holding.
 *
 * They are gone. The selected entity is a row in `entityRows`, the selected
 * claim is a row in `claimRows`, and both are already being sent to the client
 * so that the rail and the table can draw them; WorldDetail renders the pane
 * from those. Sources, the one thing genuinely not here, are fetched by the
 * pane from /api/claims/[id] when a claim is actually opened.
 *
 * What remains is one parallel batch, so the page costs a single round trip's
 * latency rather than four in sequence.
 */
export default async function WorldPage({
  searchParams,
}: {
  searchParams: Promise<{
    entity?: string
    claim?: string
    q?: string
    new?: string
    view?: string
    detail?: string
  }>
}) {
  const session = await requireReady()
  const userId = session.user.id
  const params = await searchParams

  const view: WorldViewMode = params.view === 'graph' ? 'graph' : 'table'

  const [claimRows, entityRows, typeCounts, entityTypes, predicates, signatures, graph] =
    await Promise.all([
      getClaims(userId, {
        ...(params.entity && { entityId: params.entity }),
        ...(params.q && { query: params.q }),
      }),
      getEntities(userId),
      getEntityTypeCounts(userId),
      getEntityTypes(),
      getPredicates(),
      getSignatures(),
      getGraph(userId),
    ])

  return (
    <>
      <AppHeader />

      <WorldSelectionProvider
        initial={{
          entityId: params.entity ?? null,
          claimId: params.claim ?? null,
          /*
           * `?new=claim` / `?new=entity`. `?new=1` is the spelling from when a
           * claim was the only thing you could compose, and still opens the
           * claim editor so older links and bookmarks land where they meant to.
           */
          composing:
            params.new === 'entity' ? 'entity' : params.new ? 'claim' : null,
          /*
           * Absent on a bare `?entity=` link — including the ones /claims and
           * /graph still redirect here — so such a link lands on the entity's
           * claims with the pane shut, and the bar's Details button opens it.
           */
          inspecting: params.detail === '1',
        }}
      >
        <div className="sb-world">
          <EntityFilter
            entities={entityRows}
            entityTypes={entityTypes}
            typeCounts={Object.fromEntries(typeCounts)}
          />

          <WorldCentre
            view={view}
            claims={claimRows}
            entities={entityRows}
            graph={graph}
            canCreateClaim={entityRows.length > 0}
          />

          <WorldDetail
            claims={claimRows}
            entities={entityRows}
            entityTypes={entityTypes}
            predicates={predicates}
            signatures={signatures}
          />
        </div>
      </WorldSelectionProvider>
    </>
  )
}
