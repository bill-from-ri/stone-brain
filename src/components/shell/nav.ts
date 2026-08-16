/**
 * The nav rail's items, lifted from the prototype's NAV array
 * (frontend/Stone Brain.dc.html, ~line 763).
 *
 * `phase` marks which build phase makes an item real. Anything above Phase 1 is
 * rendered dimmed and non-interactive rather than hidden — the shell should look
 * like the product it is becoming, but must never imply data it doesn't have.
 */
import type { Route } from 'next'

export type NavItem = {
  href: Route
  label: string
  icon: string
  phase: 1 | 2 | 3 | 4
}

export const NAV: NavItem[] = [
  { href: '/', label: 'Home', icon: 'ph ph-house', phase: 1 },
  { href: '/library', label: 'Library', icon: 'ph ph-folders', phase: 1 },
  { href: '/assistant', label: 'Assistant', icon: 'ph ph-pen-nib', phase: 4 },
  { href: '/claims', label: 'Claims', icon: 'ph ph-list-checks', phase: 2 },
  { href: '/conflicts', label: 'Conflicts', icon: 'ph ph-warning-diamond', phase: 3 },
  { href: '/graph', label: 'Graph', icon: 'ph ph-graph', phase: 2 },
]
