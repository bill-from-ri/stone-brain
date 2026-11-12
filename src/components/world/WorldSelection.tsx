'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from 'react'
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
 * Choosing an entity and inspecting one are two different things, and they are
 * two different pieces of state here. `entityId` narrows the claims underneath;
 * `inspecting` says whether the pane is open over that entity. Picking from the
 * rail does both, because you asked about the thing and the pane is the answer,
 * but closing the pane only clears `inspecting` — the claims stay filtered, and
 * `Show all` in the bar remains the one way to widen them again. Collapsing the
 * two meant there was no way to read an entity's claims without a pane over
 * them, and no way to dismiss the pane without also losing the filter.
 *
 * Choosing an entity does still need the server, because it re-filters the
 * claims underneath. That navigation runs as a non-blocking transition, so the
 * rail and the pane stay live and the table keeps showing the rows you have
 * while the new ones are fetched. Nothing dims or otherwise reacts to a
 * transition being in flight — the pane opening is the feedback.
 */

/**
 * What the pane is composing, if anything.
 *
 * A boolean when a claim was the only thing you could write by hand. Entities
 * had to exist already — seeded, or extracted — which made "add a claim about
 * something new" a dead end, so the bar now offers both and the pane has to
 * know which was asked for.
 */
export type ComposeTarget = 'claim' | 'entity' | null

export type Selection = {
  entityId: string | null
  claimId: string | null
  composing: ComposeTarget
  /** Whether the pane is open over `entityId`. Independent of the filter. */
  inspecting: boolean
}

type SelectionApi = Selection & {
  selectEntity: (id: string | null) => void
  selectClaim: (id: string | null) => void
  /** Opens the editor for `target`, or shuts it if it is already open. */
  toggleComposing: (target: Exclude<ComposeTarget, null>) => void
  /** Opens or closes the pane over the focused entity, leaving the filter be. */
  toggleInspecting: () => void
  /** Closes the pane, whatever it is about. The entity filter survives. */
  closeDetail: () => void
}

const SelectionContext = createContext<SelectionApi | null>(null)

export function useWorldSelection(): SelectionApi {
  const value = useContext(SelectionContext)
  if (!value) throw new Error('useWorldSelection must be used inside <WorldSelectionProvider>')
  return value
}

function sameSelection(a: Selection, b: Selection): boolean {
  return (
    a.entityId === b.entityId &&
    a.claimId === b.claimId &&
    a.composing === b.composing &&
    a.inspecting === b.inspecting
  )
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
  /*
   * `pending` is not exposed and nothing renders from it. It is here for the
   * reconcile guard below, which has to know whether a write of ours is still
   * in flight before it will adopt the server's params.
   */
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
  // Kept current after each commit rather than written during render, which
  // a render that React discards would otherwise leave behind. `commit` also
  // writes it, so two handlers in the same tick see each other's choice.
  useLayoutEffect(() => {
    latest.current = selection
  })

  useEffect(() => {
    if (pending) return
    if (sameSelection(initial, latest.current)) return
    setSelection(initial)
  }, [initial, pending])

  const commit = useCallback(
    (next: Selection) => {
      latest.current = next
      setSelection(next)

      const query = new URLSearchParams(params)
      if (next.entityId) query.set('entity', next.entityId)
      else query.delete('entity')
      if (next.claimId) query.set('claim', next.claimId)
      else query.delete('claim')
      if (next.composing) query.set('new', next.composing)
      else query.delete('new')
      if (next.inspecting && next.entityId) query.set('detail', '1')
      else query.delete('detail')

      const qs = query.toString()
      const href = (qs ? `${pathname}?${qs}` : pathname) as Route

      startTransition(() => router.replace(href, { scroll: false }))
    },
    [params, pathname, router],
  )

  const api: SelectionApi = {
    ...selection,

    // Picking an entity clears the claim: a claim about something else is not
    // an answer to "show me this entity". It also opens the pane over it —
    // clicking a rail entry is a request to see the thing, not only to filter
    // by it — which the close button and the bar's toggle can then undo.
    selectEntity: useCallback(
      (id: string | null) =>
        commit({ entityId: id, claimId: null, composing: null, inspecting: id !== null }),
      [commit],
    ),

    selectClaim: useCallback(
      (id: string | null) =>
        commit({
          entityId: latest.current.entityId,
          claimId: id,
          composing: null,
          inspecting: latest.current.inspecting,
        }),
      [commit],
    ),

    toggleComposing: useCallback(
      (target: Exclude<ComposeTarget, null>) =>
        commit({
          entityId: latest.current.entityId,
          claimId: null,
          // Asking for the other editor switches to it rather than closing:
          // only the same button twice means "never mind".
          composing: latest.current.composing === target ? null : target,
          inspecting: latest.current.inspecting,
        }),
      [commit],
    ),

    toggleInspecting: useCallback(
      () =>
        commit({
          entityId: latest.current.entityId,
          claimId: null,
          composing: null,
          inspecting: !latest.current.inspecting,
        }),
      [commit],
    ),

    /*
     * Close means close: the pane goes, and nothing else moves.
     *
     * It used to step down one level instead — a claim fell back to the entity
     * pane, and an entity, having nothing narrower to fall back to, dropped the
     * entity itself and with it the filter on the table. So the button either
     * refused to close the pane or silently widened the claims underneath, and
     * "these claims, no pane" was a state you could not reach at all. Both
     * clicks now do the one thing the X says it does; `Show all` in the bar is
     * what clears the filter.
     */
    closeDetail: useCallback(() => {
      commit({
        entityId: latest.current.entityId,
        claimId: null,
        composing: null,
        inspecting: false,
      })
    }, [commit]),
  }

  return <SelectionContext.Provider value={api}>{children}</SelectionContext.Provider>
}
