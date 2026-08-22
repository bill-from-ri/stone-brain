import 'server-only'
import type { DriveClient } from '@/lib/drive/client'
import { cleanExport, toParagraphs, type Paragraph } from '@/lib/drive/markdown'

/**
 * Reading a document's text, as one matched set of facts.
 *
 * Phase 2B §2. Everything here is deterministic — no model is involved — so it
 * is the half of extraction that can be tested against the real corpus rather
 * than judged by eye.
 */

export type DocumentText = {
  /** Cleaned export. The text the model is shown and the quotes are taken from. */
  markdown: string
  paragraphs: Paragraph[]
  /**
   * The revision the text was read at (ADR §6), or null for a document Drive
   * reports no revisions for. Provenance for the extraction — *not* a staleness
   * signal; see `DriveClient.getHeadRevisionId`.
   */
  headRevisionId: string | null
  /** Bytes of base64 image payload discarded. Worth logging; see below. */
  strippedBytes: number
}

/**
 * Export one document and prepare it for extraction.
 *
 * The revision id is fetched **before** the export, and the order is load-
 * bearing. Two API calls cannot be atomic, so an edit landing between them has
 * to be resolved in some direction: reading the revision first means a mid-flight
 * edit records an id *older* than the text, which makes the document look stale
 * and costs one needless re-extraction. The other order records an id newer than
 * the text, and the document would look current while holding claims drawn from
 * a version nobody can name. Cheap wrong beats quiet wrong.
 */
export async function readDocumentText(
  client: DriveClient,
  fileId: string,
): Promise<DocumentText> {
  const headRevisionId = await client.getHeadRevisionId(fileId)
  const raw = await client.exportMarkdown(fileId)
  const markdown = cleanExport(raw)

  return {
    markdown,
    paragraphs: toParagraphs(markdown),
    headRevisionId,
    strippedBytes: raw.length - markdown.length,
  }
}

/**
 * Rough token count, for deciding whether a document fits before spending a
 * request on finding out.
 *
 * Four characters per token is the usual English approximation and is close
 * enough for a budget check — this is a guard rail, not an accounting figure.
 * A real count would need the model's own tokenizer, and since decisions §11
 * means we do not know which model that is, a portable estimate is the only
 * honest option.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * ## Chunking — measured 2026-08-22, and not needed
 *
 * Phase 2B §2 said to measure before designing. Measured, over all 47 documents
 * in the live corpus:
 *
 * | | raw export | cleaned |
 * | --- | --- | --- |
 * | whole corpus | 3,126,286 chars | 376,461 chars (~94k tokens) |
 * | largest document | 1,569,506 chars (~392k tokens) | 81,308 chars (~20k tokens) |
 *
 * **88% of the raw bytes were base64 image data**, and 99.1% of the largest
 * document was a single embedded coat of arms. Once `cleanExport` removes it,
 * the biggest document in the corpus is about 20k tokens and the *entire*
 * library is about 94k — so every document fits in one request with room to
 * spare, on any model worth using, and one document per invocation (§4) is
 * comfortably within the 300s function limit of decisions §8.
 *
 * So there is no chunker, deliberately. Chunking a document splits the context
 * a claim depends on — a pronoun in one chunk resolving to a name in another —
 * and buying that cost for a problem this corpus does not have would be
 * speculative. `fitsInContext` below is the guard that says when that stops
 * being true.
 */

/** Conservative floor: below this, no model worth using could hold a document. */
const ASSUMED_CONTEXT_TOKENS = 128_000
/** Leave room for the vocabulary description, the instructions, and the reply. */
const PROMPT_OVERHEAD_TOKENS = 24_000

/**
 * Whether a document can go to a model whole.
 *
 * Every document in the corpus passes with an order of magnitude to spare. This
 * exists so that the day one does not, the failure is a clear message naming the
 * document rather than a truncated extraction that silently loses its second
 * half — which would look exactly like a document that simply had fewer claims
 * in it.
 */
export function fitsInContext(
  text: string,
  contextTokens: number = ASSUMED_CONTEXT_TOKENS,
): boolean {
  return estimateTokens(text) <= contextTokens - PROMPT_OVERHEAD_TOKENS
}
