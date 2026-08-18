import { AppHeader } from '@/components/shell/AppHeader'
import { EntityFilter } from '@/components/claims/EntityFilter'
import { WorldCentre } from '@/components/world/WorldCentre'
import { WorldDetail } from '@/components/world/WorldDetail'
import type { WorldViewMode } from '@/components/world/ViewToggle'
import {
  getClaim,
  getClaimSources,
  getClaims,
  getEntities,
  getEntity,
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
 */
export default async function WorldPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; claim?: string; q?: string; new?: string; view?: string }>
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

  const focus = params.entity ? await getEntity(userId, params.entity) : null

  const selected = params.claim ? await getClaim(userId, params.claim) : null
  const sources = selected ? await getClaimSources(userId, selected.id) : []

  const composing = params.new === '1'

  // Counted from the claims already fetched rather than asked of the database
  // again: this is the same set the table is showing.
  const relationshipCount = focus
    ? claimRows.filter((claim) => claim.objectId !== null).length
    : 0

  return (
    <>
      <AppHeader />

      <div className="sb-world">
        <EntityFilter
          entities={entityRows}
          entityTypes={entityTypes}
          typeCounts={Object.fromEntries(typeCounts)}
          activeEntityId={params.entity ?? null}
        />

        <WorldCentre
          view={view}
          claims={claimRows}
          focusName={focus?.name ?? null}
          selectedClaimId={selected?.id ?? null}
          graph={graph}
          activeEntityId={params.entity ?? null}
          composing={composing}
          canCreate={entityRows.length > 0}
        />

        <WorldDetail
          claim={selected}
          sources={sources}
          entity={focus}
          relationshipCount={relationshipCount}
          composing={composing}
          entities={entityRows.map((e) => ({ id: e.id, name: e.name, entityType: e.entityType }))}
          entityTypes={entityTypes}
          predicates={predicates}
          signatures={signatures}
        />
      </div>
    </>
  )
}
