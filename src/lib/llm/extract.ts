import 'server-only'
import type { Paragraph } from '@/lib/drive/markdown'
import { estimateTokens, fitsInContext } from '@/lib/documents/text'
import {
  extractionJsonSchema,
  parseExtraction,
  type CompiledOntology,
  type ExtractedClaim,
  type Rejection,
} from '@/lib/ontology/extraction'
import { normalizeName } from '@/lib/ontology/name-key'
import { chat, type ChatMessage, type ChatResult, type ProviderCredentials, type ResponseFormat } from './client'
import { ProviderError } from './errors'
import {
  EXTRACTION_SCHEMA_NAME,
  extractionSystemPrompt,
  extractionUserPrompt,
  repairPrompt,
} from './prompt'

/**
 * One document in, validated claims out — Phase 2B §4.
 *
 * This is the only place the three halves meet: §2's document text, §1's
 * provider client, and 2A's extraction contract. It owns exactly the join —
 * assembling the request, insisting the reply is usable, and spending one retry
 * on what the validator rejected. It does not touch the database; its output is
 * `ExtractedClaim[]`, which is precisely `writeExtraction()`'s input (§3).
 *
 * ## Structured output is requested, never trusted
 *
 * `response_format` goes on the request because a server that honours it
 * measurably improves the shape. But decisions §11 chose bring-your-own-
 * provider, so we cannot know that the endpoint implements it — several ignore
 * the field silently, and a local runtime may return prose with a JSON block in
 * the middle. So every reply is dragged through `extractJson()` and
 * `parseExtraction()` regardless, and the schema is treated as a hint that
 * makes the common case cheaper rather than a guarantee that makes validation
 * unnecessary.
 *
 * It also cannot be assumed the request will be *accepted*. Measured 2026-08-22
 * against Google's OpenAI-compatible endpoint: `gemini-3.7-flash` answers a
 * plain call and a `json_object` call in one to three seconds, and returns HTTP
 * 503 "experiencing high demand" to **every** `json_schema` request — 7 out of
 * 7, with a one-property schema as reliably as with the real one, while
 * `gemini-2.5-flash` and `gemini-3-flash-preview` accept the real schema on the
 * same key in the same minute. So a refusal of the strongest form is not
 * necessarily a refusal of the request, and `negotiateRequest` walks down to a
 * weaker one rather than failing a run over a capability gap.
 *
 * ## Why there is no `max_tokens`
 *
 * Deliberately unset. Gemini counts thinking tokens against that budget rather
 * than tracking them separately (ADR §11), so any figure generous enough for a
 * long document's claims is also a figure a thinking model can spend entirely
 * on thinking — returning HTTP 200, `finish_reason: "MAX_TOKENS"`, and an empty
 * string. That is a valid empty completion at the transport layer, which is why
 * this module treats an empty reply as a **failed run** rather than as a
 * document containing no claims. Those two must never be confused: one is worth
 * retrying, and the other would stamp the document as extracted and record that
 * it says nothing.
 */

export type ExtractionFailure = 'too_long' | 'empty_response' | 'unusable_response'

export class ExtractionError extends Error {
  override readonly name = 'ExtractionError'
  constructor(
    readonly code: ExtractionFailure,
    message: string,
    /** The model's reply, when there was one — for §6 to show and for debugging. */
    readonly raw?: string,
  ) {
    super(message)
  }
}

export type ExtractionInput = {
  documentName: string
  paragraphs: Paragraph[]
  ontology: CompiledOntology
  /**
   * The context window to size the document against, when the caller knows it.
   * Defaults to the conservative floor in `fitsInContext`.
   */
  contextTokens?: number
  signal?: AbortSignal
}

export type ExtractionRun = {
  claims: ExtractedClaim[]
  /**
   * What was still wrong after the retry — §6's input.
   *
   * `index` is the claim's position in the model's output **across the run**:
   * the repair attempt's claims are numbered after the first attempt's, so an
   * index is unique within a run rather than colliding between attempts.
   */
  rejections: Rejection[]
  /** What the provider says it ran — the value for `extracted_by_model` (ADR §11). */
  model: string
  /** 1 when the first reply validated clean, 2 when a repair was spent. */
  attempts: number
  /**
   * The strongest `response_format` this provider actually accepted, or null
   * when it took none of them. Worth reporting: it is the difference between
   * "this model is bad at extraction" and "this model was never constrained".
   */
  responseFormat: ResponseFormat['type'] | null
  usage: { promptTokens: number; completionTokens: number }
}

/**
 * Extract one document.
 *
 * Throws `ProviderError` for anything the transport can name (revoked key, no
 * credit, rate limited) and `ExtractionError` for a reply that arrived but
 * cannot be used. A document that genuinely contains no claims is *not* an
 * error: it returns an empty `claims` array, and the caller stamps it extracted.
 */
export async function extractClaims(
  creds: ProviderCredentials,
  input: ExtractionInput,
): Promise<ExtractionRun> {
  const system = extractionSystemPrompt(input.ontology)
  const user = extractionUserPrompt(input.documentName, input.paragraphs)

  // Checked against the assembled prompt, not the document alone: the
  // vocabulary is ~10k characters and the paragraph markers are not free, so
  // the thing that has to fit is the thing we are about to send.
  if (!fitsInContext(`${system}\n${user}`, input.contextTokens)) {
    throw new ExtractionError(
      'too_long',
      `"${input.documentName}" is about ${estimateTokens(user).toLocaleString()} tokens, ` +
        `which does not fit this model's context alongside the vocabulary.`,
    )
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]

  const { result: first, shape } = await negotiateRequest(creds, messages, input)

  const usage = {
    promptTokens: first.usage?.promptTokens ?? 0,
    completionTokens: first.usage?.completionTokens ?? 0,
  }

  const parsed = parseReply(first.text, input, 0)

  if (parsed.rejections.length === 0) {
    return {
      claims: parsed.claims,
      rejections: [],
      model: first.model,
      attempts: 1,
      responseFormat: shape.format?.type ?? null,
      usage,
    }
  }

  // The one retry. Only the rejected claims go back; `parsed.emitted` is how
  // many entries the model produced first time round, so the repair's rejection
  // indices continue the numbering instead of pointing at the wrong claim.
  const repair = await chat(creds, {
    messages: [
      ...messages,
      { role: 'assistant', content: first.text },
      { role: 'user', content: repairPrompt(parsed.rejections) },
    ],
    temperature: 0,
    // The shape the first call settled on. Re-negotiating would spend another
    // round trip discovering the same answer.
    ...(shape.format ? { responseFormat: shape.format } : {}),
    ...(shape.effort ? { reasoningEffort: shape.effort } : {}),
    signal: input.signal,
  })

  usage.promptTokens += repair.usage?.promptTokens ?? 0
  usage.completionTokens += repair.usage?.completionTokens ?? 0

  // A repair that comes back unusable is not a failed run — the first attempt's
  // accepted claims are still good, and throwing here would discard them over a
  // second-order problem. Its rejections stand as the run's rejections.
  let repaired: ParsedReply
  try {
    repaired = parseReply(repair.text, input, parsed.emitted)
  } catch {
    return {
      claims: parsed.claims,
      rejections: parsed.rejections,
      model: first.model,
      attempts: 2,
      responseFormat: shape.format?.type ?? null,
      usage,
    }
  }

  return {
    claims: dedupe([...parsed.claims, ...repaired.claims]),
    rejections: repaired.rejections,
    model: first.model,
    attempts: 2,
    responseFormat: shape.format?.type ?? null,
    usage,
  }
}

/* ------------------------------------------------------------- negotiation */

/**
 * What a request may ask for beyond the messages, and can be talked out of.
 *
 * Both fields are optional in the OpenAI-compatible surface and both are
 * unevenly implemented, so each is a preference rather than a requirement.
 */
export type RequestShape = {
  format: ResponseFormat | undefined
  effort: 'low' | undefined
}

/**
 * Extraction wants low reasoning effort.
 *
 * It is a reading task: find the sentences that assert something, copy them
 * into a fixed vocabulary. Measured on `gemini-3-flash-preview` over an
 * 8-paragraph document, the default effort spent ~63,000 thinking tokens and
 * 195 seconds and returned *fewer* claims than `'low'`, which spent none and
 * took 7. The 195s figure is the point: decisions §8 budgets 300s per
 * invocation, and one document plus a repair would not have fit.
 */
const PREFERRED_EFFORT = 'low'

/** Strongest first, effort-major: dropping effort is cheaper than dropping the schema. */
function ladder(ontology: CompiledOntology): RequestShape[] {
  const formats: (ResponseFormat | undefined)[] = [
    { type: 'json_schema', name: EXTRACTION_SCHEMA_NAME, schema: providerSchema(ontology) },
    { type: 'json_object' },
    undefined,
  ]

  return [
    ...formats.map((format) => ({ format, effort: PREFERRED_EFFORT as 'low' })),
    ...formats.map((format) => ({ format, effort: undefined })),
  ]
}

/**
 * Which rung of the ladder a given endpoint was last seen to accept.
 *
 * Process-local and deliberately not persisted: it is a cache, and being wrong
 * costs one walk of the ladder. It exists because a wasted rung is not free on
 * a free tier — Google's `gemini-3.7-flash` allows **20 requests per day** per
 * project, so rediscovering "no schema on this one" once per document would
 * spend 5% of a day's budget on a question already answered. §9's queue drain
 * pays it once per warm instance instead.
 *
 * Keyed by endpoint and model together, since the answer is a property of the
 * pair — the same key against `gemini-2.5-flash` takes the schema happily.
 */
const acceptedRung = new Map<string, number>()

/**
 * The first attempt, made as constrained as this provider will allow.
 *
 * Only a refusal *the provider articulated* moves us down the ladder — a status
 * code means the request reached a server that read it and said no, which is
 * the signature of an unsupported feature. The states decisions §11 named are
 * pointedly not in that set: a revoked key, an empty account and a rate limit
 * are true of every rung, so retrying them would turn one honest error into six
 * and burn a rate limit to rediscover it. A network failure carries no status
 * at all and is rethrown for the same reason.
 *
 * When the provider names `reasoning_effort` in its complaint — which OpenAI
 * does, verbatim, on a non-reasoning model — the rest of that effort tier is
 * skipped rather than walked. Every rung in it would fail for the same reason,
 * and the fix is one tier down, not one rung.
 *
 * The cost of a wrong guess is small and self-correcting. A genuine outage
 * costs at most the schema rung plus one more before it is rethrown (see
 * `isRequestRefusal`); a genuine capability gap
 * fails in a second or two without billing a token, because the request was
 * rejected before the model ever saw it.
 */
async function negotiateRequest(
  creds: ProviderCredentials,
  messages: ChatMessage[],
  input: ExtractionInput,
): Promise<{ result: ChatResult; shape: RequestShape }> {
  const rungs = ladder(input.ontology)
  const key = `${creds.baseUrl}|${creds.modelId}`

  // The remembered rung goes first, then the rest in their usual order — so a
  // provider that has since gained schema support is still found, one document
  // later, rather than being pinned to the weaker form forever.
  const remembered = acceptedRung.get(key)
  const order =
    remembered === undefined
      ? rungs.map((_, i) => i)
      : [remembered, ...rungs.map((_, i) => i).filter((i) => i !== remembered)]

  let lastError: unknown
  let skipEffort: RequestShape['effort'] | undefined

  for (const rung of order) {
    const shape = rungs[rung]!
    if (shape.effort !== undefined && shape.effort === skipEffort) continue

    try {
      const result = await chat(creds, {
        messages,
        // Extraction is a reading task, not a writing one; the same document
        // should yield the same claims twice. Providers that do not support the
        // parameter ignore it.
        temperature: 0,
        ...(shape.format ? { responseFormat: shape.format } : {}),
        ...(shape.effort ? { reasoningEffort: shape.effort } : {}),
        signal: input.signal,
      })
      acceptedRung.set(key, rung)
      return { result, shape }
    } catch (err) {
      if (!isRequestRefusal(err, shape)) throw err
      if (rung === remembered) acceptedRung.delete(key)
      if (namesReasoningEffort(err)) skipEffort = shape.effort
      lastError = err
    }
  }

  throw lastError
}

/** For tests, and for a settings change that should not inherit an old verdict. */
export function forgetNegotiatedShape(): void {
  acceptedRung.clear()
}

/**
 * A provider answering "no" to the request, as opposed to failing or refusing us.
 *
 * A 4xx is always the request's fault. A 5xx is read as a refusal only on a
 * schema rung, which is the one case measured to mean "unsupported" (§4:
 * `gemini-3.7-flash` 503s every `json_schema` request). Anywhere else it is an
 * outage: on 2026-09-27 the same model 503'd all six rungs while overloaded,
 * and walking the ladder turned one failed document into six spent requests.
 */
function isRequestRefusal(err: unknown, shape: RequestShape): boolean {
  if (!(err instanceof ProviderError) || err.status === undefined) return false
  if (err.reason === 'model_rejected') return true
  return err.reason === 'unreachable' && shape.format?.type === 'json_schema'
}

function namesReasoningEffort(err: unknown): boolean {
  return err instanceof ProviderError && /reasoning[_ ]?effort/i.test(err.detail)
}

/* ------------------------------------------------------------------ replies */

type ParsedReply = {
  claims: ExtractedClaim[]
  rejections: Rejection[]
  /** How many entries the model emitted, so the next attempt can keep numbering. */
  emitted: number
}

function parseReply(text: string, input: ExtractionInput, offset: number): ParsedReply {
  if (text.trim() === '') {
    throw new ExtractionError(
      'empty_response',
      'The model returned an empty response. On a thinking model this usually means ' +
        'the token budget was spent before any answer was written.',
      text,
    )
  }

  const payload = extractJson(text)
  if (payload === undefined) {
    throw new ExtractionError(
      'unusable_response',
      'The model did not return JSON. This provider may not support structured output.',
      text,
    )
  }

  const result = parseExtraction(payload, input.ontology)

  return {
    claims: result.claims,
    rejections: result.rejections.map((r) => ({ ...r, index: r.index + offset })),
    emitted: result.claims.length + result.rejections.length,
  }
}

/**
 * JSON out of a reply that was asked for JSON and may not have complied.
 *
 * Tried in order of how much benefit of the doubt each step extends: the whole
 * string, then the contents of a fenced block, then the outermost braces. The
 * last is the one that earns its keep against providers that ignore
 * `response_format` and prepend "Here are the claims I found:".
 */
export function extractJson(text: string): unknown | undefined {
  const attempt = (candidate: string): unknown | undefined => {
    try {
      return JSON.parse(candidate) as unknown
    } catch {
      return undefined
    }
  }

  const trimmed = text.trim()
  const direct = attempt(trimmed)
  if (direct !== undefined) return direct

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)
  if (fenced) {
    const inner = attempt(fenced[1]!.trim())
    if (inner !== undefined) return inner
  }

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start !== -1 && end > start) return attempt(trimmed.slice(start, end + 1))

  return undefined
}

/**
 * The JSON Schema as a provider should see it.
 *
 * `$schema` is a JSON Schema meta-keyword rather than part of the object being
 * described, and OpenAI's structured-output validator rejects a request
 * carrying unknown top-level keywords. Zod emits it; every provider either
 * ignores it or refuses it, so nobody loses anything by its removal.
 */
function providerSchema(ontology: CompiledOntology): unknown {
  const schema = extractionJsonSchema(ontology) as Record<string, unknown>
  const { $schema: _meta, ...rest } = schema
  return rest
}

/**
 * Collapse claims that say the same thing.
 *
 * Only reachable after a repair: the model is told not to resend accepted
 * claims, and mostly obeys, but "mostly" would otherwise show up as inflated
 * counts in the run result. The database would not be fooled — `writeExtraction`
 * keys on a generated fingerprint — so this is about the number reported to a
 * person, and it keeps the *first* occurrence, whose quote came from the
 * attempt that read the document rather than the one that read a critique.
 */
function dedupe(claims: ExtractedClaim[]): ExtractedClaim[] {
  const seen = new Set<string>()
  const out: ExtractedClaim[] = []

  for (const claim of claims) {
    const key = [
      claim.subjectType,
      normalizeName(claim.subjectName),
      claim.predicate,
      claim.objectType ?? '',
      claim.objectName ? normalizeName(claim.objectName) : '',
      claim.valueInt ?? claim.valueFloat ?? claim.valueString ?? claim.valueTime ?? '',
      claim.startTime ?? '',
      claim.endTime ?? '',
    ].join(' ')

    if (seen.has(key)) continue
    seen.add(key)
    out.push(claim)
  }

  return out
}
