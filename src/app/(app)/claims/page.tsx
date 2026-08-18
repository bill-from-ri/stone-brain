import { AppHeader } from '@/components/shell/AppHeader'
import { ClaimDetail } from '@/components/claims/ClaimDetail'
import { ClaimsTable } from '@/components/claims/ClaimsTable'
import { EntityFilter } from '@/components/claims/EntityFilter'
import { NewClaimButton } from '@/components/claims/NewClaimButton'
import {
  getClaim,
  getClaimSources,
  getClaims,
  getEntities,
  getEntity,
  getEntityTypeCounts,
  getEntityTypes,
  getPredicates,
  getSignatures,
} from '@/db/queries/claims'
import { requireReady } from '@/lib/auth/guard'

export const dynamic = 'force-dynamic'

/**
 * The Claims screen, from the prototype's CLAIMS view (lines 443-515).
 *
 * The prototype framed this as *one extraction run awaiting commit* — a
 * progress bar of new / already-in-graph / contradicting, a checkbox per row,
 * and a "Commit to graph" footer. None of that exists yet: there is no
 * extraction (Phase 2B) and no contradiction detection (Phase 3), so a
 * selection UI would be checkboxes over nothing.
 *
 * What is kept is the part that was always right — the three-column claim
 * table, and a right pane showing the passage a claim rests on. Here it lists
 * the whole graph rather than one document's output, which is what the data
 * actually is today.
 */
export default async function ClaimsPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; claim?: string; q?: string; new?: string }>
}) {
  const session = await requireReady()
  const userId = session.user.id
  const params = await searchParams

  const [claimRows, entityRows, typeCounts, entityTypes, predicates, signatures] = await Promise.all([
    getClaims(userId, {
      ...(params.entity && { entityId: params.entity }),
      ...(params.q && { query: params.q }),
    }),
    getEntities(userId),
    getEntityTypeCounts(userId),
    getEntityTypes(),
    getPredicates(),
    getSignatures(),
  ])

  const focus = params.entity ? await getEntity(userId, params.entity) : null

  const selected = params.claim ? await getClaim(userId, params.claim) : null
  const sources = selected ? await getClaimSources(userId, selected.id) : []

  const composing = params.new === '1'

  return (
    <>
      <AppHeader />

      <div className="sb-claims">
        <EntityFilter
          entities={entityRows}
          entityTypes={entityTypes}
          typeCounts={Object.fromEntries(typeCounts)}
          activeEntityId={params.entity ?? null}
        />

        <ClaimsTable
          claims={claimRows}
          focusName={focus?.name ?? null}
          selectedClaimId={selected?.id ?? null}
          actions={<NewClaimButton composing={composing} disabled={entityRows.length === 0} />}
        />

        <ClaimDetail
          claim={selected}
          sources={sources}
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
