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

/**
 * Where "Mark as verified" / "Mark as unverified" may take a document from
 * here, or null when the action does not apply.
 *
 * Verified is a person's word about an *extraction* — "I have read what came
 * out of this and it is right" — so it can only follow one. A document that
 * was never extracted has nothing to vouch for, and offering the button there
 * would let "Verified" mean "I have not looked".
 *
 * Re-extracting a verified document returns it to Extracted (the write path's
 * `stampDocument`): the new claims are ones nobody has read yet.
 */
export function verificationTarget(
  status: string | null | undefined,
  verified: boolean,
): { from: DocumentStatus; to: DocumentStatus } | null {
  if (verified) return status === 'extracted' ? { from: 'extracted', to: 'verified' } : null
  return status === 'verified' ? { from: 'verified', to: 'extracted' } : null
}

/**
 * Whether Drive has moved past the version the last extraction read.
 *
 * `drive_version`, never `extracted_revision_id`: Drive keeps checkpoint
 * revisions for a native Doc rather than one per edit, so a revision id that
 * has not moved does not mean the text has not (ADR §6, second correction). A
 * document never extracted is not "stale" — it is unextracted, and its status
 * already says so.
 */
export function isStale(doc: {
  driveVersion: number | null
  extractedDriveVersion: number | null
}): boolean {
  return (
    doc.extractedDriveVersion !== null &&
    doc.driveVersion !== null &&
    doc.driveVersion > doc.extractedDriveVersion
  )
}
