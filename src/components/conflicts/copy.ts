import type { Conflict, ConflictClaim, ValueConflict } from '@/db/queries/conflicts'
import { predicateText } from '@/components/shared/predicate'

/**
 * The words the Conflicts screen uses, in one place so the inbox item and the
 * heading it opens can never describe the same conflict differently.
 */

/** What a claim says, as the object column of the claim table would show it. */
export function answerOf(claim: Pick<ConflictClaim, 'objectName' | 'value'>): string {
  return claim.objectName ?? claim.value ?? '—'
}

/** "AD 400 – AD 412", "from AD 400", "until AD 412", or null when undated. */
export function periodText(claim: Pick<ConflictClaim, 'startTime' | 'endTime'>): string | null {
  const { startTime, endTime } = claim
  if (startTime && endTime) return `${startTime} – ${endTime}`
  if (startTime) return `from ${startTime}`
  if (endTime) return `until ${endTime}`
  return null
}

/** The claim as a sentence: "Sera Vane rules Ashfall". */
export function sentenceOf(claim: ConflictClaim): string {
  return `${claim.subjectName} ${predicateText(claim.predicateLabel)} ${answerOf(claim)}`
}

export function titleOf(conflict: Conflict): string {
  if (conflict.kind === 'vanished_source') return sentenceOf(conflict.claim)
  return `${conflict.subject.name} — ${predicateText(conflict.predicate.label)}`
}

/** The inbox line under the title. */
export function metaOf(conflict: Conflict): string {
  if (conflict.kind === 'vanished_source') {
    const names = [...new Set(conflict.claim.sources.map((s) => s.documentName ?? 'an unknown document'))]
    return `Source gone: ${names.join(', ')}`
  }
  return conflict.sides.map((s) => answerOf(s.claims[0]!)).join(' vs. ')
}

/**
 * Why these claims are a conflict, in a sentence that names the gate that let
 * them through — so a person deciding "not a conflict" knows exactly what the
 * system assumed.
 */
export function explainValue(conflict: ValueConflict): string {
  const label = `“${conflict.predicate.label}”`
  const n = conflict.sides.length
  const answers = n === 2 ? 'two different answers' : `${n} different answers`
  if (!conflict.predicate.isTemporal) {
    return `${label} holds one value for each ${conflict.subject.type}, and the claims give ${conflict.subject.name} ${answers}. Dates do not separate them: this is not something that changes over time.`
  }
  const undated = conflict.sides.every((s) => s.claims.every((c) => !c.startTime && !c.endTime))
  return undated
    ? `${label} holds one value at a time, and the claims give ${conflict.subject.name} ${answers} with no dates to tell them apart. If they held one after the other, give each its dates and this resolves itself.`
    : `${label} holds one value at a time, and the claims give ${conflict.subject.name} ${answers} for periods that overlap. If they were a succession, correct the dates and this resolves itself.`
}

export function provenanceLabel(createdBy: string): string {
  if (createdBy === 'seed') return 'Seeded by hand'
  if (createdBy === 'llm') return 'Extracted'
  return 'Entered by hand'
}
