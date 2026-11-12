/**
 * Where a quote sits in a document, and whether two quotes cite the same text.
 *
 * Extraction scoring asks two questions of every quote, and they are kept apart
 * because they fail for different reasons:
 *
 *   1. Is it **verbatim**? A quote is a citation a person will follow back to
 *      the document, so a paraphrase is a defect even when the fact is right.
 *   2. Does it **overlap** the ground truth's quote? It need not be the same
 *      substring — the hand seeds of *Written Map* quote whole paragraphs, the
 *      prompt asks for "the exact substring that supports the claim" — only
 *      share some of the same text, so both point at the same passage.
 *
 * ## What "verbatim" forgives
 *
 * Whitespace, and the shape of quotation marks — nothing else. Documents
 * export with curly quotes (`Dragon’s Shroud`) and models routinely straighten
 * them on the way out; that is a typesetting difference, not a paraphrase, and
 * the person following the citation finds the same words either way. Case,
 * dashes, ellipses and every other character must match: a quote with "…" in
 * the middle is two quotes stitched together, which is exactly the thing a
 * citation must not be.
 */

/** The fields of a document paragraph these checks read. */
export type QuotedParagraph = { index: number; text: string }

/** One place a quote was found, as a half-open range in the paragraph's normalised text. */
export type QuoteSpan = { paragraph: number; start: number; end: number }

/**
 * The shortest stretch of shared text that counts as overlapping, in
 * normalised characters. Long enough that two adjacent fragments touching at a
 * space or a shared "the" do not count; capped by the shorter quote, so a
 * three-word infobox cell can still overlap the row it sits in.
 */
export const MIN_SHARED_CHARS = 10

const SINGLE_QUOTES = /[‘’‚‛′]/g
const DOUBLE_QUOTES = /[“”„‟″]/g

/** The form both a quote and the text it is searched in are compared in. */
export function normalizeQuoteText(text: string): string {
  return text.replace(SINGLE_QUOTES, "'").replace(DOUBLE_QUOTES, '"').replace(/\s+/g, ' ').trim()
}

/**
 * Every place `quote` occurs verbatim, across all paragraphs.
 *
 * All occurrences rather than the first, because a short quote ("the Empire")
 * can occur in several paragraphs and only one of them may be the passage the
 * ground truth cites. Empty means the quote is not in the document at all.
 */
export function locateQuote(quote: string, paragraphs: readonly QuotedParagraph[]): QuoteSpan[] {
  const needle = normalizeQuoteText(quote)
  if (needle.length === 0) return []

  const spans: QuoteSpan[] = []
  for (const paragraph of paragraphs) {
    const haystack = normalizeQuoteText(paragraph.text)
    for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
      spans.push({ paragraph: paragraph.index, start: at, end: at + needle.length })
    }
  }
  return spans
}

/** Whether any span of one quote shares at least `MIN_SHARED_CHARS` (or all of the shorter) with any span of the other. */
export function spansOverlap(a: readonly QuoteSpan[], b: readonly QuoteSpan[]): boolean {
  return a.some((x) =>
    b.some((y) => {
      if (x.paragraph !== y.paragraph) return false
      const shared = Math.min(x.end, y.end) - Math.max(x.start, y.start)
      const needed = Math.min(MIN_SHARED_CHARS, x.end - x.start, y.end - y.start)
      return shared >= needed && shared > 0
    }),
  )
}
