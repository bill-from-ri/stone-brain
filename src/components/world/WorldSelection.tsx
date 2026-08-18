'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { Route } from 'next'

/**
 * What the World screen is currently about, held on the client.
 *
 * Selection used to live only in the query string, which meant every click on a
 * row or a rail entry was a full navigation: the server re-ran the claims
 * query, the entity list, the type counts, the whole ontology and the graph in
 * order to change which 320px pane was open. The pane could not appear until
 * all of that came back, so opening it took a visible beat.
 *
 * Here the click updates local state immediately and the URL catches up inside
 * a transition. The URL is still the source of truth for a *reload* — it is
 * seeded from the server's params and re-adopts them on back/forward — but it
 * is no longer on the path between clicking a thing and seeing it.
 *
 * Choosing an entity does still need the server, because it re-filters the
 * claims underneath. That navigation now runs as a non-blocking transition:
 * `pending` lets the table say it is catching up while the rail and the pane
 * stay live, rather than the screen freezing until it lands.
 */

export type Selection = {
  entityId: string | null
  claimId: string | null
  composing: boolean
}

type SelectionApi = Selection & {
  /** True while a selection change is still being reflected by the server. */
  pending: boolean
  selectEntity: (id: string | null) => void
  selectClaim: (id: string | null) => void
  toggleComposing: () => void
  /** Drops the narrowest thing currently open — the pane's close button. */
  closeDetail: () => void
}

const SelectionContext = createContext<SelectionApi | null>(null)

export function useWorldSelection(): SelectionApi {
  const value = useContext(SelectionContext)
  if (!value) throw new Error('useWorldSelection must be used inside <WorldSelectionProvider>')
  return value
}

function sameSelection(a: Selection, b: Selection): boolean {
  return a.entityId === b.entityId && a.claimId === b.claimId && a.composing === b.composing
}

export function WorldSelectionProvider({
  initial,
  children,
}: {
  initial: Selection
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()

  const [selection, setSelection] = useState<Selection>(initial)

  /*
   * Re-adopt the server's params, but only once nothing of ours is in flight.
   *
   * While a transition is pending the props still describe the *previous*
   * selection, and adopting them would visibly undo the click that started it.
   * Worse, two fast clicks would otherwise let the first one's render land on
   * top of the second. Waiting for `pending` to clear means the only params we
   * ever adopt are settled ones — which is exactly the back/forward case this
   * needs to handle.
   */
  const latest = useRef(selection)
  latest.current = selection

  useEffect(() => {
    if (pending) return
    if (sameSelection(initial, latest.current)) return
    setSelection(initial)
  }, [initial, pending])

  const commit = useCallback(
    (next: Selection) => {
      setSelection(next)

      const query = new URLSearchParams(params)
      if (next.entityId) query.set('entity', next.entityId)
      else query.delete('entity')
      if (next.claimId) query.set('claim', next.claimId)
      else query.delete('claim')
      if (next.composing) query.set('new', '1')
      else query.delete('new')

      const qs = query.toString()
      const href = (qs ? `${pathname}?${qs}` : pathname) as Route

      startTransition(() => router.replace(href, { scroll: false }))
    },
    [params, pathname, router],
  )

  const api: SelectionApi = {
    ...selection,
    pending,

    // Picking an entity clears the claim: a claim about something else is not
    // an answer to "show me this entity".
    selectEntity: useCallback(
      (id: string | null) => commit({ entityId: id, claimId: null, composing: false }),
      [commit],
    ),

    selectClaim: useCallback(
      (id: string | null) =>
        commit({ entityId: latest.current.entityId, claimId: id, composing: false }),
      [commit],
    ),

    toggleComposing: useCallback(
      () =>
        commit({
          entityId: latest.current.entityId,
          claimId: null,
          composing: !latest.current.composing,
        }),
      [commit],
    ),

    /*
     * Closing undoes whatever the pane is currently about. Over a claim or the
     * editor that is the claim, dropping you back to the entity you were
     * reading; over an entity there is nothing narrower to fall back to, so it
     * clears the entity itself rather than leaving a button that does nothing.
     */
    closeDetail: useCallback(() => {
      const now = latest.current
      if (now.claimId || now.composing) {
        commit({ entityId: now.entityId, claimId: null, composing: false })
      } else {
        commit({ entityId: null, claimId: null, composing: false })
      }
    }, [commit]),
  }

  return <SelectionContext.Provider value={api}>{children}</SelectionContext.Provider>
}
