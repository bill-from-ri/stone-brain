import 'server-only'
import { ProviderError, classifyStatus, safeDetail } from './errors'

/**
 * The single HTTP path to the user's inference provider.
 *
 * Deliberately `fetch` and not an SDK. Decisions §11 chose "any OpenAI-compatible
 * endpoint" over "one provider", and an SDK would pull in one vendor's request
 * shape, retries and error objects — exactly the coupling that decision spent
 * effort avoiding. Chat completions is a JSON POST; this is the whole of it.
 *
 * There is no retry here, unlike the Drive client. A 429 from someone else's
 * paid account is not ours to burn through: decisions §11 makes rate-limiting a
 * *state* the UI shows, and Phase 2B §9 makes backing off the scheduler's job.
 * Retrying quietly would defeat both.
 *
 * Nothing in this module ever logs, and nothing it throws carries the key — see
 * `safeDetail`.
 */

export type ProviderCredentials = {
  /** No trailing slash; run it through `normalizeBaseUrl` first. */
  baseUrl: string
  apiKey: string
  modelId: string
}

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type ChatOptions = {
  messages: ChatMessage[]
  /**
   * Careful on reasoning models. Gemini counts thinking tokens *against* this
   * budget rather than tracking them separately the way OpenAI's o-series does,
   * so a value that looks generous for the answer alone comes back HTTP 200
   * with `finish_reason: "MAX_TOKENS"` and an empty string. That is not an error
   * anywhere in this module — it is a valid, empty completion — so §4's
   * extraction must either leave this unset or set it well clear of the
   * thinking budget, and treat an empty body as a failed extraction rather than
   * as a document with no claims in it.
   */
  maxTokens?: number
  temperature?: number
  /**
   * How hard to constrain the reply. Omitted means free text.
   *
   * Sent verbatim as OpenAI's `response_format`. Support is genuinely uneven —
   * some servers honour the schema, some ignore the field, and some reject the
   * request — which is why §4 validates every reply regardless and walks down
   * this list when a provider refuses the strongest form. See
   * `negotiateFormat()` in extract.ts.
   */
  responseFormat?: ResponseFormat
  /**
   * How much thinking to buy on a reasoning model.
   *
   * Worth setting, and worth being able to withdraw. Measured 2026-08-22 on
   * `gemini-3-flash-preview` over an 8-paragraph document: unset spent ~63,000
   * thinking tokens and 195s, `'low'` spent none and 7s — and returned *more*
   * claims. But the parameter is not universally accepted: OpenAI rejects it
   * outright on a non-reasoning model, so a caller that sets it must be
   * prepared to drop it (see `negotiateRequest` in extract.ts).
   */
  reasoningEffort?: 'low' | 'medium' | 'high'
  signal?: AbortSignal
}

export type ResponseFormat =
  /** Constrained decoding against a schema. Best when available. */
  | { type: 'json_schema'; name: string; schema: unknown }
  /** Valid JSON, shape unconstrained. Widely supported where the schema is not. */
  | { type: 'json_object' }

export type ChatResult = {
  text: string
  /** What the provider says it actually ran — the value for `extracted_by_model`. */
  model: string
  usage?: { promptTokens?: number; completionTokens?: number }
}

/** How long we wait on a provider before calling it unreachable. */
const REQUEST_TIMEOUT_MS = 120_000
/** The probe is one token; it has no business taking as long as a real call. */
const PROBE_TIMEOUT_MS = 20_000

/**
 * Trailing slashes are the single most common paste error in a base URL, and
 * `${base}/chat/completions` with one produces a `//` that some gateways 404 on.
 * Normalising on the way *in* to the database means every read is already clean.
 */
export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '')
}

type ChatResponseBody = {
  model?: string
  choices?: { message?: { content?: string | null } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

async function post(
  creds: ProviderCredentials,
  body: unknown,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs)
  const composed = signal ? AbortSignal.any([signal, timeout]) : timeout

  try {
    return await fetch(`${creds.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${creds.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: composed,
    })
  } catch (err) {
    // A caller-initiated abort is not a provider failure, so it is re-thrown
    // rather than classified — the caller already knows it cancelled.
    if (signal?.aborted) throw err

    const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'unreachable'
    throw new ProviderError(
      'unreachable',
      reason === 'timed out'
        ? `The provider did not respond within ${Math.round(timeoutMs / 1000)}s.`
        : 'Could not connect. Check the base URL, including its scheme and any /v1 suffix.',
    )
  }
}

function retryAfterSeconds(response: Response): number | undefined {
  const header = response.headers.get('retry-after')
  if (!header) return undefined
  const seconds = Number(header)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined
}

async function throwForStatus(response: Response, creds: ProviderCredentials): Promise<never> {
  const reason = classifyStatus(response.status)
  const body = await response.text().catch(() => '')

  const fallback: Record<typeof reason, string> = {
    unauthorized: 'The provider rejected this API key.',
    payment_required: 'The provider reports no remaining credit on this account.',
    rate_limited: 'The provider is rate limiting this key.',
    model_rejected: `The provider refused the request for "${creds.modelId}".`,
    unreachable: `The provider returned HTTP ${response.status}.`,
  }

  throw new ProviderError(
    reason,
    safeDetail(body, creds.apiKey, fallback[reason]),
    response.status,
    retryAfterSeconds(response),
  )
}

/**
 * `response_format` as OpenAI spells it. The nesting under `json_schema` and
 * the `strict` flag are the vendor's shape, so they live here rather than in
 * every caller.
 */
function wireFormat(format: ResponseFormat): unknown {
  if (format.type === 'json_object') return { type: 'json_object' }
  return {
    type: 'json_schema',
    json_schema: { name: format.name, schema: format.schema, strict: true },
  }
}

/** One chat completion. Throws ProviderError for anything the caller can render. */
export async function chat(creds: ProviderCredentials, options: ChatOptions): Promise<ChatResult> {
  const response = await post(
    creds,
    {
      model: creds.modelId,
      messages: options.messages,
      ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.responseFormat ? { response_format: wireFormat(options.responseFormat) } : {}),
      ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
    },
    REQUEST_TIMEOUT_MS,
    options.signal,
  )

  if (!response.ok) await throwForStatus(response, creds)

  const body = (await response.json().catch(() => null)) as ChatResponseBody | null
  const text = body?.choices?.[0]?.message?.content

  if (typeof text !== 'string') {
    // A 200 with no content is a compatibility failure, not a model failure:
    // something at that URL speaks HTTP but not this API.
    throw new ProviderError(
      'model_rejected',
      'The provider returned a response with no message content.',
      response.status,
    )
  }

  return {
    text,
    model: body?.model ?? creds.modelId,
    usage: {
      promptTokens: body?.usage?.prompt_tokens,
      completionTokens: body?.usage?.completion_tokens,
    },
  }
}

/**
 * The connection check behind "Save and verify".
 *
 * It is a real one-token completion rather than a `GET /models`, because it is
 * the only request that tests all three fields the form collects at once — base
 * URL, key, *and* model ID. `/models` would leave the model unvalidated, and
 * plenty of OpenAI-compatible servers (local runtimes especially) do not
 * implement it, so a 404 there would be indistinguishable from a bad URL.
 *
 * Resolves on success; throws ProviderError, which the caller turns into a
 * stored health state.
 */
export async function probe(creds: ProviderCredentials): Promise<{ model: string }> {
  const response = await post(
    creds,
    {
      model: creds.modelId,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
    },
    PROBE_TIMEOUT_MS,
  )

  if (!response.ok) await throwForStatus(response, creds)

  const body = (await response.json().catch(() => null)) as ChatResponseBody | null

  // Deliberately not requiring content: `max_tokens: 1` legitimately returns an
  // empty string on some providers — on Gemini's thinking models it always
  // does, because the single token is spent before any answer is emitted. A 200
  // with a choices array is proof enough that the key and the model are good,
  // which is all this probe claims to establish.
  if (!Array.isArray(body?.choices)) {
    throw new ProviderError(
      'model_rejected',
      'That URL answered, but not with an OpenAI-compatible chat completion.',
      response.status,
    )
  }

  return { model: body.model ?? creds.modelId }
}
