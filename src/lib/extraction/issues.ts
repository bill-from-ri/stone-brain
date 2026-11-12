import type { ExtractionIssueStage } from '@/db/schema'

/**
 * A dropped claim, made readable.
 *
 * `extraction_issues.received` holds the claim verbatim in whichever shape it
 * was in when it was lost, and the two stages lose it at different points: a
 * validation rejection holds the model's wire format (`subject`, `object`,
 * `value`), a write refusal holds the validated `ExtractedClaim`
 * (`subjectName`, `objectName`, `valueInt`…). This reads either into the three
 * things a person needs to judge it — the claim as a sentence, the quote it
 * came from, and the paragraph — and degrades to whatever is there, since a
 * rejected claim may be rejected precisely for missing half of itself.
 */
export type IssueView = {
  subject: string | null
  predicate: string | null
  /** The object entity or the value, whichever the claim carried. */
  object: string | null
  quote: string | null
  paragraph: number | null
}

export function viewIssue(stage: ExtractionIssueStage, received: unknown): IssueView {
  const r = received && typeof received === 'object' ? (received as Record<string, unknown>) : {}
  const text = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() !== '' ? v : typeof v === 'number' ? String(v) : null

  if (stage === 'write') {
    return {
      subject: text(r.subjectName),
      predicate: text(r.predicate),
      object:
        text(r.objectName) ??
        text(r.valueString) ??
        text(r.valueTime) ??
        text(r.valueInt) ??
        text(r.valueFloat),
      quote: text(r.quote),
      paragraph: typeof r.paragraphIndex === 'number' ? r.paragraphIndex : null,
    }
  }

  return {
    subject: text(r.subject),
    predicate: text(r.predicate),
    object: text(r.object) ?? text(r.value),
    quote: text(r.quote),
    paragraph: typeof r.paragraph === 'number' ? r.paragraph : null,
  }
}
