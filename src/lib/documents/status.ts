/**
 * Document status, and how it renders.
 *
 * The stored value and the label deliberately differ: `'unread'` shows as
 * **Unverified**. The schema comment on `DocumentStatus` records why — renaming
 * the value is a migration, and the display name is presentation.
 *
 * Phase 1 hardcoded "Unverified" on every row regardless of the column. This is
 * the single map that replaces it, so the table and the detail pane cannot
 * drift apart.
 */

import type { DocumentStatus } from '@/db/schema'

type Display = {
  label: string
  /** Matches the prototype's tag classes: neutral unless the state is earned. */
  tone: 'neutral' | 'good'
}

const DISPLAY: Record<DocumentStatus, Display> = {
  unread: { label: 'Unverified', tone: 'neutral' },
  extracted: { label: 'Extracted', tone: 'neutral' },
  verified: { label: 'Verified', tone: 'good' },
}

/** Anything unrecognised reads as unverified — never as a state we cannot back. */
export function displayStatus(status: string | null | undefined): Display {
  return DISPLAY[(status ?? 'unread') as DocumentStatus] ?? DISPLAY.unread
}
