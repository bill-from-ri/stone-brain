/**
 * The nav rail's items, lifted from the design prototype's NAV array (the
 * prototype is no longer in the repo).
 *
 * `phase` marks which build phase makes an item real. Anything above it is
 * rendered dimmed rather than hidden — the shell should look like the product it
 * is becoming, but must never imply data it doesn't have.
 *
 * Claims and Graph moved to 1 when Phase 2A gave them real data. The marker
 * tracks whether a screen is backed, not which phase first drew it.
 *
 * Those two then became one item, World: they were the same entities and the
 * same claims drawn two ways, and a rail that offers them separately asks you
 * to choose a rendering before you have chosen a question. /claims and /graph
 * redirect into it.
 *
 * Conflicts moved to 1 when Phase 3 made it real. It is also the one item that
 * carries a count (`badge`): an open conflict is the thing in the product most
 * worth knowing about from another screen.
 */
import type { Route } from 'next'

export type NavItem = {
  href: Route
  label: string
  icon: string
  phase: 1 | 2 | 3 | 4
  /** A live count the rail draws beside the label. */
  badge?: 'conflicts'
}

export const NAV: NavItem[] = [
  { href: '/', label: 'Home', icon: 'ph ph-house', phase: 1 },
  { href: '/library', label: 'Library', icon: 'ph ph-folders', phase: 1 },
  { href: '/world', label: 'World', icon: 'ph ph-graph', phase: 1 },
  { href: '/assistant', label: 'Assistant', icon: 'ph ph-pen-nib', phase: 4 },
  { href: '/conflicts', label: 'Conflicts', icon: 'ph ph-warning-diamond', phase: 1, badge: 'conflicts' },
]
