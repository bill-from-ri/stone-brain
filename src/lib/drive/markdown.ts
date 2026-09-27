/**
 * Google's markdown export, and the paragraph anchoring built on top of it.
 *
 * Claims cite their source as a paragraph index (the prototype's `¶ 4`), and
 * ADR §7 settled that those indices come from the markdown export rather than
 * the Docs API — precise character offsets would need `documents.readonly`,
 * which is another restricted scope.
 *
 * The index is a citation anchor, so it has to be *stable for a given export*
 * and cheap to recompute. It is not stable across edits to the document, which
 * is what `documents.extracted_revision_id` is for.
 *
 * ## What the export actually looks like
 *
 * Measured across the 47-document corpus, not assumed (see `markdown.test.ts`,
 * whose fixtures are lifted verbatim from real exports):
 *
 * - **Headings** become ATX (`#` … `####`) and always have a blank line after
 *   them, so each is already its own paragraph. Google emits a bare `# ` for an
 *   empty heading paragraph, which is punctuation with no document in it.
 * - **Bullet and numbered lists** are *not* blank-line separated. Items end in
 *   two spaces — a markdown hard break — so a whole list arrives as one block.
 *   That is the behaviour we want: a list is one citable unit, and splitting it
 *   would scatter eight ministries across eight citations.
 * - **Tables** are pipe tables with no internal blank lines, so a table is also
 *   one block. Two kinds arrive, and they need opposite treatment — see
 *   `splitLayoutTable` below.
 * - **Images** are the thing that matters, and are **dropped entirely** —
 *   non-text input is out of scope until the project is ready to digest it.
 *   Google inlines every image as a base64 `data:` URI in a link-reference
 *   definition at the end of the file; in this corpus that was **88% of all
 *   exported bytes**, and 99% of the largest document. Both halves go: the
 *   definition carrying the payload, and the `![][image1]` marker referring to
 *   it. Nothing image-shaped reaches the prompt or the database, and
 *   `DocumentText.strippedBytes` records what each document shed. If images
 *   ever come into scope, `cleanExport` is the only place that changes.
 * - **Punctuation is backslash-escaped** (`\.`, `\_`, `\-`, `\#`) far more
 *   eagerly than markdown requires, because Google escapes defensively rather
 *   than contextually.
 * - **Bold and italic** arrive as `**…**` / `*…*`. They are stripped: they are
 *   invisible to a reader and break quotes that cross them (see `EMPHASIS`).
 */

/** A blank-line-separated block of the document, and its place in it. */
export type Paragraph = {
  /** 0-based. This is the `¶ n` a claim cites. */
  index: number
  text: string
  /**
   * The heading trail this paragraph sits under, outermost first — the section
   * context a model needs to read a paragraph correctly, and a person needs to
   * find it again in the document. Empty at the top of a document.
   */
  headings: string[]
  kind: ParagraphKind
}

export type ParagraphKind = 'heading' | 'list' | 'table' | 'prose'

/**
 * The CommonMark escapable set, minus the pipe.
 *
 * Unescaping is worth doing because the escaped form reaches two places it does
 * not belong: the prompt, where `Motto: \_` is noise, and `claim_sources.quote`,
 * which a person eventually reads. The pipe is excluded because unescaping it
 * inside a table cell would add a column separator and break the row — no
 * export in the corpus contained one, and this keeps it that way by
 * construction rather than by luck.
 */
const ESCAPED = /\\([\\`*_{}[\]()#+\-.!~<>"'$%&,/:;=?@^])/g

/** `[image1]: <data:image/png;base64,…>` — one line, however many megabytes. */
const IMAGE_DEFINITION = /^\[[^\]]*\]:\s*<data:[^>]*>\s*$/gm

/**
 * `![][image1]` and `![alt](url)` — the reference at the point of use.
 *
 * The leading `[ \t]*` is load-bearing. Twelve table rows in the corpus hold
 * images inline (`Gabelford Town ![][image1] ![][image2] Coat of Arms`), and
 * deleting them without their preceding space would leave a *run* of spaces —
 * which is precisely the signal `splitLayoutTable` reads as a paragraph break.
 * Removing an image would then manufacture a paragraph boundary that was never
 * in the document. Consuming the space before, and keeping the one after,
 * closes the gap to a single space instead.
 */
const INLINE_IMAGE = /[ \t]*!\[[^\]]*\](?:\((?:[^()]*)\)|\[[^\]]*\])/g

/** A heading with no text: `#`, `## `, and so on. */
const EMPTY_HEADING = /^#{1,6}[ \t]*$/gm

/**
 * Bold and italic delimiters: `**Eldi**`, `*aside*`, `__x__`, `_x_`.
 *
 * Emphasis is invisible in the document a person reads, but left in it splits
 * the text a quote is taken from — "the **Eldi** of the Amber Coast" does not
 * contain "the Eldi of the Amber Coast", so a faithful quote fails to match and
 * the natural one is marked up. Google escapes every *literal* `*` and `_`
 * (`\*`, `\_`), so an unescaped one is always markup; the lookbehind leaves the
 * escaped ones for `ESCAPED` to restore.
 *
 * An opening delimiter must touch the word after it and a closing one the word
 * before it, which is what keeps a `* item` list bullet — followed by a space,
 * and at the start of a line — out of it.
 */
const EMPHASIS = /(?<!\\)(?:\*{1,3}|_{1,3})(?=[^\s*_])|(?<=[^\s*_\\])(?:\*{1,3}|_{1,3})/g

/**
 * Strip an export down to what a reader would actually see.
 *
 * Everything removed here is either invisible in the document (escapes, hard-
 * break padding) or unreadable by anything downstream (base64 payloads). No
 * prose is dropped, so the result is still the document — which matters,
 * because the quotes stored against a claim are taken from this text and have
 * to be findable in the thing a person opens in Drive.
 */
export function cleanExport(markdown: string): string {
  return (
    markdown
      .replace(/\r\n/g, '\n')
      // Before anything else: on the largest document in the corpus this drops
      // 1.55 MB of the 1.57 MB file, and every regex below is spared it.
      .replace(IMAGE_DEFINITION, '')
      .replace(INLINE_IMAGE, '')
      .replace(EMPTY_HEADING, '')
      // Before unescaping, while a literal `\*` is still distinguishable from markup.
      .replace(EMPHASIS, '')
      .replace(ESCAPED, '$1')
      // Trailing spaces are markdown's hard-break marker, which has no meaning
      // once the text is prose in a prompt. Stripping them also stops a line of
      // pure padding from looking like content.
      .split('\n')
      .map((line) => line.replace(/[ \t]+$/, ''))
      .join('\n')
      // The removals above leave their blank lines behind.
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

/* --------------------------------------------------------- layout tables */

/**
 * Google Docs' wiki-article layout — body text in one column, an infobox in the
 * other — exports as a pipe table holding the entire article in a single cell.
 * Twelve of the corpus's 47 documents are built this way, and they are the
 * claim-dense ones: nations, cities, armies. Left alone, an 8,700-character
 * article becomes *one* paragraph, and every claim drawn from it cites "¶ 1",
 * which is to say the whole document.
 *
 * Inside such a cell the paragraph breaks survive only as runs of two or more
 * spaces, because a markdown table cell cannot contain a newline. That is a
 * weak signal, so it is used only where it is trustworthy, guarded three ways —
 * each guard is there because a real document in the corpus needs it:
 *
 * 1. **Cell size.** Genuine data tables in this corpus top out at 293
 *    characters per cell; layout cells start at 692. The threshold sits in that
 *    empty gap, so no calendar or population table is ever considered.
 * 2. **Row count.** `Rough Timeline` is a real 23-row `| year | event |` table
 *    with one long cell. Shredding it would separate every date from its event.
 *    Layout tables in the corpus have two to four rows.
 * 3. **Split quality.** Content that is *made* of spaces — the ASCII maps in
 *    `Basic City Maps` — would explode into confetti. So the split is
 *    *attempted* and then judged on its **median** piece: prose splits into
 *    paragraphs of a few hundred characters, whereas a false split produces
 *    mostly fragments. The median rather than the minimum, because a legitimate
 *    split often contains one short piece — a section heading that lived inside
 *    the table, like `Government & Politics` — and judging on the shortest
 *    piece threw away three whole documents for it.
 *
 * Where the guards all pass, the pieces are contiguous substrings of the cell,
 * so a quote taken from one is still findable in the document.
 */
const LAYOUT_CELL_CHARS = 600
const LAYOUT_MAX_ROWS = 4
/** A median piece shorter than this is fragments, not paragraphs. */
const MIN_MEDIAN_PART = 40

/** Rows like `| :---- | ----- |` carry alignment, not content. */
function isDelimiterRow(row: string): boolean {
  return /^\|[\s:|-]+\|?\s*$/.test(row.trim())
}

function tableCells(block: string): string[] {
  return block
    .split('\n')
    .filter((row) => row.trim().startsWith('|') && !isDelimiterRow(row))
    .flatMap((row) =>
      row
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|'),
    )
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0)
}

function medianLength(pieces: string[]): number {
  const lengths = pieces.map((piece) => piece.length).sort((a, b) => a - b)
  const mid = Math.floor(lengths.length / 2)
  return lengths.length % 2 === 0
    ? ((lengths[mid - 1]! + lengths[mid]!) / 2)
    : lengths[mid]!
}

/**
 * The blocks a table should become: itself, or the paragraphs hidden inside it.
 */
function splitLayoutTable(block: string): string[] {
  const rows = block.split('\n').filter((row) => row.trim().startsWith('|') && !isDelimiterRow(row))
  if (rows.length > LAYOUT_MAX_ROWS) return [block]

  const cells = tableCells(block)
  if (cells.length === 0) return [block]
  if (!cells.some((cell) => cell.length > LAYOUT_CELL_CHARS)) return [block]

  const parts: string[] = []
  for (const cell of cells) {
    if (cell.length <= LAYOUT_CELL_CHARS) {
      parts.push(cell)
      continue
    }
    const pieces = cell
      .split(/ {2,}/)
      .map((piece) => piece.trim())
      .filter((piece) => piece.length > 0)

    // Guard 3: judged after the fact, because whether two spaces meant a
    // paragraph break is only knowable from what the split produced.
    if (pieces.length > 1 && medianLength(pieces) < MIN_MEDIAN_PART) return [block]
    parts.push(...pieces)
  }

  return parts
}

function kindOf(block: string): ParagraphKind {
  if (/^#{1,6}\s/.test(block)) return 'heading'
  if (block.startsWith('|')) return 'table'
  if (/^\s*(?:[-*+]|\d+[.)])\s/.test(block)) return 'list'
  return 'prose'
}

/** `## Government` → `{ level: 2, title: 'Government' }` */
function parseHeading(block: string): { level: number; title: string } | null {
  const match = /^(#{1,6})\s+(.*)$/.exec(block)
  if (!match) return null
  return { level: match[1]!.length, title: match[2]!.trim() }
}

/**
 * Split a *cleaned* export into citable paragraphs.
 *
 * Pass `cleanExport()` output, not a raw Drive export — given a raw one, the
 * base64 image definitions become their own multi-megabyte paragraphs and take
 * citation indices with them.
 */
export function toParagraphs(markdown: string): Paragraph[] {
  const blocks = markdown
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    // A wiki-layout table is one block holding a whole article; unpacking it
    // here rather than in cleanExport keeps the cleaned markdown a faithful
    // copy of the document, and confines the restructuring to the citation
    // anchors, which is the only thing that needed it.
    .flatMap((block) => (block.startsWith('|') ? splitLayoutTable(block) : [block]))

  const paragraphs: Paragraph[] = []
  /** Open headings by level, so a deeper section does not close a shallower one. */
  const trail: { level: number; title: string }[] = []

  for (const block of blocks) {
    const kind = kindOf(block)
    const heading = kind === 'heading' ? parseHeading(block) : null

    if (heading) {
      // Close every section at or below this one before opening it. Without
      // this, an `##` following a `###` would nest under it.
      while (trail.length > 0 && trail[trail.length - 1]!.level >= heading.level) trail.pop()
    }

    paragraphs.push({
      index: paragraphs.length,
      text: block,
      // A heading is labelled with its ancestors, not with itself.
      headings: trail.map((h) => h.title),
      kind,
    })

    if (heading) trail.push(heading)
  }

  return paragraphs
}

/** Just the text, for the rare caller that wants no structure. */
export function paragraphTexts(markdown: string): string[] {
  return toParagraphs(markdown).map((p) => p.text)
}

/**
 * The document as a model sees it, with the citation anchors made explicit.
 *
 * The `¶n` markers are the whole point: a model cannot cite a paragraph index
 * it was never shown, and asking it to count blocks itself is asking it to do
 * arithmetic instead of extraction. Phase 2B §4 feeds this to the prompt, and
 * every index it hands back indexes straight into `toParagraphs()`.
 */
export function renderForPrompt(paragraphs: Paragraph[]): string {
  return paragraphs.map((p) => `[¶${p.index}] ${p.text}`).join('\n\n')
}
