'use client'

import { useEffect, useState } from 'react'
import type {
  ClaimRow,
  ClaimSourceRow,
  EntityRow,
  EntityTypeOption,
} from '@/db/queries/claims'
import { DetailPaneShell } from '@/components/shared/DetailPaneShell'
import { ClaimDetail } from '@/components/claims/ClaimDetail'
import { EntityDetail } from './EntityDetail'
import { useWorldSelection } from './WorldSelection'

/**
 * The right pane, and the one place that decides what it is about.
 *
 * Precedence runs from the most specific thing you have picked to the least:
 * a claim you clicked, else the entity you are looking through *if you asked to
 * see it*, else nothing — in which case the pane closes and the table takes the
 * width, the same rule the Library follows.
 *
 * Composing is no longer one of the cases. Both editors moved to WorldComposer,
 * which is a modal: a form that only ever had 320px to live in could not grow,
 * and the pane's editors made the bar's buttons flip to `Cancel` to have a way
 * of being closed. This pane is for what is *selected*, which is a different
 * question from what is being written.
 *
 * That middle clause is the whole of `inspecting`. An entity being selected
 * means the claims are filtered to it, which is a question about the table and
 * not a request for a pane; the pane over it opens when picked from the rail
 * and closes on the X or Escape, and the filter is untouched either way.
 *
 * A CLIENT component, and that is the whole point of it. Everything it needs to
 * draw is already here: the claim is the row that was clicked and the entity is
 * the rail entry that was clicked, both of which the browser is holding in
 * order to have drawn them in the first place. Rendering them cost a full
 * server round trip only because selection was spelled in the URL. The one
 * genuinely absent thing is a claim's source passages, fetched below.
 */
export function WorldDetail({
  claims,
  entities,
  entityTypes,
}: {
  /** The rows the table is showing — the pool a claim selection resolves in. */
  claims: ClaimRow[]
  entities: EntityRow[]
  entityTypes: EntityTypeOption[]
}) {
  const { entityId, claimId, inspecting, closeDetail, selectClaim, selectEntity } =
    useWorldSelection()

  const localClaim = claimId ? (claims.find((c) => c.id === claimId) ?? null) : null
  const { claim, sources, loading } = useClaimDetail(claimId, localClaim)

  const entity = entityId ? (entities.find((e) => e.id === entityId) ?? null) : null
  const shownEntity = inspecting ? entity : null

  /*
   * Counted from the rows the client already has rather than asked of the
   * database. When an entity is selected the table is filtered to it, and when
   * it is not the full list still contains every claim touching it, so the
   * filter below is correct either way.
   */
  const relationshipCount = entity
    ? claims.filter(
        (c) => c.objectId !== null && (c.subjectId === entity.id || c.objectId === entity.id),
      ).length
    : 0

  const body = claim ? (
      <ClaimDetail
        claim={claim}
        sources={sources}
        sourcesLoading={loading}
        onDeleted={() => selectClaim(null)}
      />
    ) : shownEntity ? (
      <EntityDetail
        entity={shownEntity}
        entityTypes={entityTypes}
        relationshipCount={relationshipCount}
        /* Deleting takes the entity itself, so the filter it was narrowing the
           table by goes too — anything else leaves the World filtered to
           something that no longer exists. */
        onDeleted={() => selectEntity(null)}
      />
    ) : null

  // Open the moment something is picked, not when its sources arrive: the claim
  // itself is already known, and holding the pane shut for the fetch would put
  // back exactly the delay this removed.
  const open = Boolean(claimId) || Boolean(shownEntity)

  /*
   * Escape closes the pane. The composer's modal stops the key at itself, so a
   * press with a half-typed claim on screen answers the modal and leaves this
   * pane where it was.
   */
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDetail()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closeDetail])

  return (
    <DetailPaneShell open={open} onClose={closeDetail} width={320}>
      {body}
    </DetailPaneShell>
  )
}

/**
 * A claim's sources, and — only when it is not already on screen — the claim.
 *
 * `known` is the row from the table, which is the normal case and renders with
 * no fetch at all. The fetch still runs for its sources, and doubles as the way
 * a `?claim=` link to something outside the current filter still opens.
 */
function useClaimDetail(
  claimId: string | null,
  known: ClaimRow | null,
): { claim: ClaimRow | null; sources: ClaimSourceRow[]; loading: boolean } {
  const [fetched, setFetched] = useState<{
    id: string
    claim: ClaimRow | null
    sources: ClaimSourceRow[]
  } | null>(null)

  useEffect(() => {
    if (!claimId) return

    // An abort rather than a cancelled flag: clicking down a list of claims
    // should not leave a queue of responses racing to land in the pane.
    const controller = new AbortController()

    fetch(`/api/claims/${claimId}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { claim?: ClaimRow; sources?: ClaimSourceRow[] } | null) => {
        setFetched({ id: claimId, claim: body?.claim ?? null, sources: body?.sources ?? [] })
      })
      .catch(() => {
        // Aborted, offline, or a 500. The claim itself is already drawn from the
        // table row; leaving the sources section in its loading state would be a
        // worse lie than showing the claim with no passages under it.
        if (!controller.signal.aborted) setFetched({ id: claimId, claim: null, sources: [] })
      })

    return () => controller.abort()
  }, [claimId])

  if (!claimId) return { claim: null, sources: [], loading: false }

  const hit = fetched?.id === claimId ? fetched : null
  return {
    claim: known ?? hit?.claim ?? null,
    sources: hit?.sources ?? [],
    loading: hit === null,
  }
}
