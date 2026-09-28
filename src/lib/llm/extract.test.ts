import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Paragraph } from '@/lib/drive/markdown'
import { coreOntology } from '@/lib/ontology/extraction'
import { ProviderError } from './errors'
import { extractClaims, ExtractionError, extractJson, forgetNegotiatedShape } from './extract'
import type { ProviderCredentials } from './client'

/**
 * The parts of §4 that are ours rather than the model's.
 *
 * Whether a given model extracts *good* claims is not testable here and is
 * §7's job; what is testable is everything around the reply — that a provider
 * refusing structured output is walked down to a form it accepts, that a
 * rejected claim costs one retry and not the run, and that an empty completion
 * is never mistaken for a document with nothing in it. All three are failures
 * that would otherwise look like a bad model.
 */

const creds: ProviderCredentials = {
  baseUrl: 'https://provider.test/v1',
  apiKey: 'sk-secret-key-1234',
  modelId: 'test/model',
}

const ontology = coreOntology()

const paragraphs: Paragraph[] = [
  { index: 0, text: 'Ashfall', headings: [], kind: 'heading' },
  { index: 1, text: 'Sera Vane rules Ashfall, a town of 1,200 souls.', headings: ['Ashfall'], kind: 'prose' },
]

const input = { documentName: 'Ashfall', paragraphs, ontology }

const rulesClaim = {
  subject: 'Sera Vane',
  subject_type: 'character',
  predicate: 'rules',
  object: 'Ashfall',
  object_type: 'settlement',
  quote: 'Sera Vane rules Ashfall',
  paragraph: 1,
}

/** A 200 carrying `content`, in the OpenAI chat-completion shape. */
function completion(content: string, model = 'test/model-0613'): Response {
  return new Response(
    JSON.stringify({
      model,
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    }),
    { status: 200 },
  )
}

function failure(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message } }), { status })
}

/** Replies in order, one per call; the last is repeated if asked for again. */
function mockFetch(...responses: Response[]) {
  let call = 0
  const fn = vi.fn(async () => responses[Math.min(call++, responses.length - 1)]!.clone())
  vi.stubGlobal('fetch', fn)
  return fn
}

const bodyOf = (fn: ReturnType<typeof mockFetch>, call: number): Record<string, unknown> =>
  JSON.parse((fn.mock.calls[call] as unknown as [string, RequestInit])[1].body as string) as Record<
    string,
    unknown
  >

afterEach(() => {
  vi.unstubAllGlobals()
  // The negotiated rung is process-local and would otherwise leak between
  // tests, which is exactly the point of it — but not here.
  forgetNegotiatedShape()
})

describe('extractJson', () => {
  it('takes a clean object as it stands', () => {
    expect(extractJson('{"claims":[]}')).toEqual({ claims: [] })
  })

  it('unwraps a fenced block, which a model emits even when told not to', () => {
    expect(extractJson('```json\n{"claims":[]}\n```')).toEqual({ claims: [] })
  })

  it('salvages an object from surrounding prose', () => {
    expect(extractJson('Here are the claims I found:\n{"claims":[]}\nHope that helps!')).toEqual({
      claims: [],
    })
  })

  it('gives up rather than guessing when there is no object', () => {
    expect(extractJson('I could not find any claims.')).toBeUndefined()
  })
})

describe('extractClaims', () => {
  it('asks for a schema first, and reports the format that was accepted', async () => {
    const fetchMock = mockFetch(completion(JSON.stringify({ claims: [rulesClaim] })))

    const run = await extractClaims(creds, input)

    expect(run.claims).toHaveLength(1)
    expect(run.claims[0]).toMatchObject({ subjectName: 'Sera Vane', predicate: 'rules' })
    expect(run.attempts).toBe(1)
    expect(run.responseFormat).toBe('json_schema')
    expect(run.model).toBe('test/model-0613')

    const body = bodyOf(fetchMock, 0)
    expect(body).toMatchObject({
      response_format: { type: 'json_schema' },
      reasoning_effort: 'low',
    })
    // Left unset on purpose: a thinking model would spend the budget on
    // thinking and return an empty completion. See the module header.
    expect(body).not.toHaveProperty('max_tokens')
  })

  it('strips $schema, which OpenAI rejects and nothing needs', async () => {
    const fetchMock = mockFetch(completion('{"claims":[]}'))
    await extractClaims(creds, input)

    const format = bodyOf(fetchMock, 0).response_format as {
      json_schema: { schema: Record<string, unknown> }
    }
    expect(format.json_schema.schema).not.toHaveProperty('$schema')
    expect(format.json_schema.schema).toHaveProperty('properties')
  })

  it('falls back to json_object when the provider refuses a schema', async () => {
    // gemini-3.7-flash, measured 2026-08-22: 503 to every json_schema request,
    // and a prompt reply to the same call without one.
    const fetchMock = mockFetch(
      failure(503, 'This model is currently experiencing high demand.'),
      completion(JSON.stringify({ claims: [rulesClaim] })),
    )

    const run = await extractClaims(creds, input)

    expect(run.claims).toHaveLength(1)
    expect(run.responseFormat).toBe('json_object')
    expect(bodyOf(fetchMock, 1).response_format).toEqual({ type: 'json_object' })
  })

  it('falls back to free text when the provider refuses every JSON mode', async () => {
    const fetchMock = mockFetch(
      failure(400, 'response_format is not supported'),
      failure(400, 'response_format is not supported'),
      completion('Sure! ```json\n{"claims":[]}\n```'),
    )

    const run = await extractClaims(creds, input)

    expect(run.responseFormat).toBeNull()
    expect(bodyOf(fetchMock, 2)).not.toHaveProperty('response_format')
  })

  it('drops reasoning_effort when the provider names it, without walking the rest of the tier', async () => {
    const fetchMock = mockFetch(
      failure(400, "Unsupported parameter: 'reasoning_effort' is not supported with this model."),
      completion(JSON.stringify({ claims: [rulesClaim] })),
    )

    const run = await extractClaims(creds, input)

    expect(run.claims).toHaveLength(1)
    // Two calls, not four: the whole low-effort tier is skipped at once, and the
    // schema is asked for again rather than sacrificed alongside the effort.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(bodyOf(fetchMock, 1)).not.toHaveProperty('reasoning_effort')
    expect(run.responseFormat).toBe('json_schema')
  })

  it('does not walk the ladder for the states §11 names — they are true of every rung', async () => {
    const fetchMock = mockFetch(failure(429, 'Rate limit exceeded.'))

    await expect(extractClaims(creds, input)).rejects.toMatchObject({
      name: 'ProviderError',
      reason: 'rate_limited',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rethrows the last refusal when no rung is accepted', async () => {
    mockFetch(failure(400, 'Bad request.'))
    await expect(extractClaims(creds, input)).rejects.toBeInstanceOf(ProviderError)
  })

  it('treats a 5xx past the schema rung as an outage, not a refusal', async () => {
    // gemini-3.7-flash, 2026-09-27: overloaded, 503 to every rung. Walking all
    // six spent six requests of a 20/day free tier on one document.
    const fetchMock = mockFetch(failure(503, 'Overloaded.'))

    await expect(extractClaims(creds, input)).rejects.toMatchObject({
      name: 'ProviderError',
      reason: 'unreachable',
    })
    // The schema rung's 503 is read as "unsupported"; json_object's is not.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps a remembered rung through an outage rather than re-walking the ladder', async () => {
    mockFetch(failure(503, 'busy'), completion('{"claims":[]}'))
    await extractClaims(creds, input)

    const fetchMock = mockFetch(failure(503, 'busy'), completion('{"claims":[]}'))
    await expect(extractClaims(creds, input)).rejects.toMatchObject({ reason: 'unreachable' })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const next = mockFetch(completion('{"claims":[]}'))
    await extractClaims(creds, input)
    expect(bodyOf(next, 0).response_format).toEqual({ type: 'json_object' })
  })

  it('spends one retry on rejected claims and banks the ones that passed', async () => {
    const fetchMock = mockFetch(
      completion(
        JSON.stringify({
          claims: [rulesClaim, { ...rulesClaim, predicate: 'governs', object: 'Ashfall' }],
        }),
      ),
      completion(
        JSON.stringify({
          claims: [{ ...rulesClaim, subject: 'Sera Vane', predicate: 'resides_in' }],
        }),
      ),
    )

    const run = await extractClaims(creds, input)

    expect(run.attempts).toBe(2)
    expect(run.rejections).toEqual([])
    expect(run.claims.map((c) => c.predicate)).toEqual(['rules', 'resides_in'])
    // Prompt and usage both accumulate across the two calls.
    expect(run.usage).toEqual({ promptTokens: 200, completionTokens: 40 })

    const repair = bodyOf(fetchMock, 1).messages as { role: string; content: string }[]
    expect(repair).toHaveLength(4)
    expect(repair[3]!.content).toContain("'governs' is not in the vocabulary")
  })

  it('numbers surviving rejections after the first attempt’s output', async () => {
    mockFetch(
      completion(JSON.stringify({ claims: [rulesClaim, { ...rulesClaim, predicate: 'governs' }] })),
      completion(JSON.stringify({ claims: [{ ...rulesClaim, predicate: 'governs' }] })),
    )

    const run = await extractClaims(creds, input)

    expect(run.claims).toHaveLength(1)
    expect(run.rejections).toHaveLength(1)
    // The first attempt emitted two entries, so the repair's first entry is 2 —
    // an index that cannot be confused with either of them.
    expect(run.rejections[0]).toMatchObject({ index: 2, code: 'unknown_predicate' })
  })

  it('keeps the first attempt’s claims when the repair comes back unusable', async () => {
    mockFetch(
      completion(JSON.stringify({ claims: [rulesClaim, { ...rulesClaim, predicate: 'governs' }] })),
      completion('I am sorry, I cannot correct those.'),
    )

    const run = await extractClaims(creds, input)

    expect(run.claims.map((c) => c.predicate)).toEqual(['rules'])
    expect(run.rejections).toHaveLength(1)
    expect(run.attempts).toBe(2)
  })

  it('collapses a repair that resends a claim it was told to leave alone', async () => {
    mockFetch(
      completion(JSON.stringify({ claims: [rulesClaim, { ...rulesClaim, predicate: 'governs' }] })),
      completion(
        JSON.stringify({ claims: [{ ...rulesClaim, quote: 'Sera Vane rules Ashfall, a town' }] }),
      ),
    )

    const run = await extractClaims(creds, input)

    expect(run.claims).toHaveLength(1)
    // The surviving copy is the one whose quote came from reading the document.
    expect(run.claims[0]!.quote).toBe('Sera Vane rules Ashfall')
  })

  it('treats an empty completion as a failed run, not an empty document', async () => {
    mockFetch(completion(''))

    await expect(extractClaims(creds, input)).rejects.toMatchObject({
      name: 'ExtractionError',
      code: 'empty_response',
    })
  })

  it('accepts a genuinely empty extraction', async () => {
    mockFetch(completion('{"claims":[]}'))

    const run = await extractClaims(creds, input)
    expect(run.claims).toEqual([])
    expect(run.rejections).toEqual([])
  })

  it('reports a reply with no JSON in it rather than retrying into the void', async () => {
    mockFetch(completion('I was unable to find any claims in this document.'))

    await expect(extractClaims(creds, input)).rejects.toMatchObject({
      name: 'ExtractionError',
      code: 'unusable_response',
      raw: 'I was unable to find any claims in this document.',
    })
  })

  it('remembers the rung a provider accepted, so the next document does not rediscover it', async () => {
    const fetchMock = mockFetch(
      failure(503, 'This model is currently experiencing high demand.'),
      completion('{"claims":[]}'),
    )

    await extractClaims(creds, input)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await extractClaims(creds, input)
    // One more call, not two: the json_schema rung is not tried again.
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(bodyOf(fetchMock, 2).response_format).toEqual({ type: 'json_object' })
  })

  it('forgets a remembered rung the moment it stops working', async () => {
    mockFetch(failure(503, 'busy'), completion('{"claims":[]}'))
    await extractClaims(creds, input)

    const fetchMock = mockFetch(failure(400, 'response_format is not supported'), completion('{"claims":[]}'))
    const run = await extractClaims(creds, input)

    // The remembered json_object rung is tried first and refused, so the walk
    // restarts from the top and lands on the schema.
    expect(bodyOf(fetchMock, 0).response_format).toEqual({ type: 'json_object' })
    expect(run.responseFormat).toBe('json_schema')
  })

  it('refuses a document that cannot fit, before spending a request on it', async () => {
    const fetchMock = mockFetch(completion('{"claims":[]}'))
    const huge: Paragraph[] = [{ index: 0, text: 'x'.repeat(600_000), headings: [], kind: 'prose' }]

    await expect(extractClaims(creds, { ...input, paragraphs: huge })).rejects.toBeInstanceOf(
      ExtractionError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
