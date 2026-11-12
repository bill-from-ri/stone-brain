import { renderForPrompt, type Paragraph } from '@/lib/drive/markdown'
import { describeVocabulary, type CompiledOntology, type Rejection } from '@/lib/ontology/extraction'

/**
 * What the model is actually told.
 *
 * Kept apart from `extract.ts` — which owns the call, the validation and the
 * retry — because the prompt is the part a person tunes and a test asserts on,
 * and neither wants a network client in the import graph. Nothing here is
 * `server-only`: it is string assembly, and being able to print it without a
 * provider configured is most of how extraction quality gets debugged.
 *
 * ## Everything derives from the compiled ontology
 *
 * `describeVocabulary()` renders the same `CompiledOntology` that
 * `parseExtraction()` validates against, so a predicate offered here is a
 * predicate accepted there by construction (see the header of
 * src/lib/ontology/extraction.ts). This module adds no vocabulary of its own —
 * if a rule about *which* predicate to use ever needs stating, it belongs in
 * that predicate's `description` in the registry, where both the prompt and the
 * rejection message can reach it.
 */

/** Name for the JSON Schema sent as `response_format`. */
export const EXTRACTION_SCHEMA_NAME = 'claim_extraction'

/**
 * The rules, in the order a model reads them.
 *
 * Three of these exist because of a specific downstream consumer, and are worth
 * naming so they are not "tidied" away:
 *
 *   - **Verbatim quotes.** `claim_sources.quote` is what a person clicks
 *     through to check. A paraphrase there is a citation that cannot be
 *     verified against the document, which is worse than no citation.
 *   - **One direction only.** `predicates.inverse_name` means the reverse of a
 *     relationship is generated rather than extracted (§5). Asking for both
 *     doubles the output and produces pairs that disagree.
 *   - **Dates copied as written.** `ordinalFor()` parses the world's own
 *     calendar (docs/calendar.md) and stores an unparseable label with a null
 *     ordinal — unordered but not lost. A model "helpfully" converting to a
 *     Gregorian date destroys the only thing that could be parsed later.
 *
 * Rule 2 used to end "if nothing fits, drop the claim", which was right about
 * the graph and wrong about the vocabulary: a dropped sentence leaves no trace,
 * so a gap the extractor hit on every document was invisible. Proposals give
 * that sentence somewhere to go that is not the graph (§6). The section is
 * kept short and ends on "most documents need none" because the failure on the
 * other side is a model that proposes a predicate for every claim it found
 * slightly awkward — `parseProposals` drops names already in the vocabulary,
 * but cannot drop a near-duplicate of one.
 */
export function extractionSystemPrompt(ontology: CompiledOntology): string {
  return [
    'You extract structured claims from a worldbuilding document into a fixed vocabulary.',
    '',
    'Return JSON of the form { "claims": [ … ], "proposed_predicates": [ … ] }. Emit',
    'nothing else — no prose, no markdown fences, no commentary.',
    '',
    'RULES',
    '',
    '1. Only claims the document states. Do not infer, combine, or supply general',
    '   knowledge. If the document does not say it, it is not a claim.',
    '2. Use only the predicates and entity types listed below. Never substitute a',
    '   near-synonym — a wrong-but-legal predicate is worse than a missing one,',
    '   because nothing downstream will flag it. If the document states a',
    '   relationship or attribute that no listed predicate can express, propose it',
    '   (see PROPOSED PREDICATES) instead of forcing it or silently dropping it.',
    '3. A relationship takes "object" and "object_type". An attribute takes "value".',
    '   Never both, never neither.',
    '4. State each relationship once, in the direction the document states it. The',
    '   reverse direction is generated automatically; emitting it yourself produces',
    '   duplicates.',
    '5. "quote" must be copied verbatim from the paragraph you cite — the exact',
    '   substring that supports the claim, not a paraphrase and not the whole',
    '   paragraph. "paragraph" is the number in the [¶n] marker that quote came from.',
    '6. Name entities as the document names them, in their fullest form. Resolve',
    '   pronouns and epithets to the name ("he" → "Sera Vane"). Do not invent a',
    '   canonical spelling the document never uses.',
    '7. Copy dates exactly as written, including the era or calendar label. Do not',
    '   convert them to any other calendar.',
    '8. Use "start_time" / "end_time" only when the document says a fact held for a',
    '   period. A claim with no stated period leaves them out.',
    '',
    'PROPOSED PREDICATES',
    '',
    'Only for a fact the vocabulary cannot express — never for one a listed predicate',
    'covers. One entry per missing predicate: "name" (snake_case), "description" (one',
    'sentence), "subject_type", "object_type" (relationships only), "example_subject",',
    '"example_object" (the object or the value), "quote" (verbatim) and "paragraph".',
    'Most documents need none; then leave the field out.',
    '',
    'VOCABULARY',
    '',
    describeVocabulary(ontology),
  ].join('\n')
}

/**
 * The document, with its citation anchors made explicit.
 *
 * The `[¶n]` markers come from `renderForPrompt`, and the indices they carry
 * index straight into `toParagraphs()` — which is the whole reason the model is
 * shown them rather than asked to count blocks itself.
 */
export function extractionUserPrompt(documentName: string, paragraphs: Paragraph[]): string {
  return [
    `DOCUMENT: ${documentName}`,
    '',
    renderForPrompt(paragraphs),
    '',
    'Extract every claim this document states that the vocabulary can express.',
  ].join('\n')
}

/** How many rejections are worth sending back; beyond this the run is not salvageable by nagging. */
const MAX_REPAIR_ITEMS = 40

/**
 * The one retry.
 *
 * Only the rejected claims go back, with the validator's own message attached —
 * those messages were written for this reader (see `describeIssues`), naming
 * the legal alternatives rather than dumping the enum. The accepted claims are
 * deliberately *not* re-sent: they are already banked, and asking for them
 * again invites the model to revise work that was fine.
 *
 * The instruction to drop rather than force is the important half. A model told
 * only "fix these" will contort a claim into a legal shape it does not mean,
 * and rule 2's wrong-but-legal predicate is exactly what that produces.
 */
export function repairPrompt(rejections: Rejection[]): string {
  const shown = rejections.slice(0, MAX_REPAIR_ITEMS)

  const items = shown.map((r, i) =>
    [
      `${i + 1}. ${r.message}`,
      `   You emitted: ${JSON.stringify(r.received)}`,
    ].join('\n'),
  )

  return [
    `${rejections.length} of your claims were rejected by the validator.`,
    shown.length < rejections.length ? `The first ${shown.length} are shown.` : '',
    '',
    items.join('\n'),
    '',
    'Return { "claims": [ … ] } containing ONLY corrected versions of these claims.',
    'Do not resend the claims that were accepted.',
    'If a claim cannot be expressed in the vocabulary without changing what the',
    'document says, drop it rather than forcing it into a predicate that does not',
    'mean the same thing. Returning fewer claims is the correct answer here. A fact',
    'the vocabulary has no predicate for may go in "proposed_predicates" instead.',
  ]
    .filter((line) => line !== '')
    .join('\n')
}
