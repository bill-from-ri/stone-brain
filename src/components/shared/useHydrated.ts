import { useSyncExternalStore } from 'react'

const never = () => () => {}

/**
 * False during the server render and the hydrating pass, true from then on.
 *
 * For a component that must draw something different in the browser — a
 * layout computed from engine-specific floating point, a preference read from
 * localStorage — without a hydration mismatch. It used to be spelled
 * `useEffect(() => setMounted(true), [])` in each place, which costs a second
 * render scheduled from an effect; `useSyncExternalStore` with a different
 * server snapshot is React's own way of saying "the client knows more", and
 * it switches over within hydration rather than after it.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    never,
    () => true,
    () => false,
  )
}
