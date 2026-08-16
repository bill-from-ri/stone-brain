/**
 * Paragraph anchoring for exported documents.
 *
 * Claims cite their source as a paragraph index (the prototype's `¶ 4`), and
 * ADR §7 settled that those indices come from the markdown export rather than
 * the Docs API — precise character offsets would need `documents.readonly`,
 * which is another restricted scope.
 *
 * The index is a citation anchor, so it has to be *stable for a given export*
 * and cheap to recompute. It is not stable across edits to the document, which
 * is what `documents.extracted_revision_id` is for.
 */

/**
 * Splits an exported document on blank lines.
 *
 * Returns 0-based paragraphs with surrounding whitespace removed and empty runs
 * dropped, so `paragraphs[n]` is what a claim citing `¶ n` refers to.
 */
export function toParagraphs(markdown: string): string[] {
  return markdown
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
}
