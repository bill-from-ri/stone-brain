import { afterEach, describe, expect, it, vi } from 'vitest'
import { chat, normalizeBaseUrl, probe, type ProviderCredentials } from './client'
import { ProviderError, classifyStatus, safeDetail } from './errors'

/**
 * The provider is someone else's server, so the only thing worth testing here
 * is how we behave when it misbehaves: the four states decisions §11 names must
 * come out of the right status codes, and nothing that leaves this module may
 * carry the key.
 */

const creds: ProviderCredentials = {
  baseUrl: 'https://provider.test/v1',
  apiKey: 'sk-secret-key-1234',
  modelId: 'test/model',
}

function respond(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers })
}

function mockFetch(response: Response | Error) {
  const fn = vi.fn(async () => {
    if (response instanceof Error) throw response
    return response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('normalizeBaseUrl', () => {
  it('strips trailing slashes, the commonest paste error', () => {
    expect(normalizeBaseUrl('https://openrouter.ai/api/v1/')).toBe('https://openrouter.ai/api/v1')
    expect(normalizeBaseUrl('  https://x.test/v1///  ')).toBe('https://x.test/v1')
  })

  it('leaves an already-clean URL alone', () => {
    expect(normalizeBaseUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1')
  })
})

describe('classifyStatus', () => {
  it('maps the states §11 names to their own reasons', () => {
    expect(classifyStatus(401)).toBe('unauthorized')
    expect(classifyStatus(403)).toBe('unauthorized')
    expect(classifyStatus(402)).toBe('payment_required')
    expect(classifyStatus(429)).toBe('rate_limited')
  })

  it('reads any other 4xx as the request’s fault, and 5xx as the provider’s', () => {
    expect(classifyStatus(404)).toBe('model_rejected')
    expect(classifyStatus(400)).toBe('model_rejected')
    expect(classifyStatus(500)).toBe('unreachable')
    expect(classifyStatus(503)).toBe('unreachable')
  })
})

describe('safeDetail', () => {
  it('pulls the message out of both common error shapes', () => {
    expect(safeDetail('{"error":{"message":"no such model"}}', creds.apiKey, 'fallback')).toBe(
      'no such model',
    )
    expect(safeDetail('{"error":"flat string"}', creds.apiKey, 'fallback')).toBe('flat string')
  })

  it('falls back rather than dumping a non-JSON body', () => {
    expect(safeDetail('<html>502 Bad Gateway</html>', creds.apiKey, 'fallback')).toBe('fallback')
    expect(safeDetail('{"unrelated":1}', creds.apiKey, 'fallback')).toBe('fallback')
  })

  it('redacts the key even though no provider should be echoing it', () => {
    const detail = safeDetail(
      JSON.stringify({ error: { message: `bad key ${creds.apiKey} rejected` } }),
      creds.apiKey,
      'fallback',
    )
    expect(detail).not.toContain(creds.apiKey)
    expect(detail).toBe('bad key **** rejected')
  })

  it('bounds the length so a provider cannot write a novel into our database', () => {
    const long = safeDetail(
      JSON.stringify({ error: { message: 'x'.repeat(1000) } }),
      creds.apiKey,
      'fallback',
    )
    expect(long.length).toBeLessThanOrEqual(240)
  })

  it('flattens control characters, so the result is safe in a log line', () => {
    expect(safeDetail('{"message":"a\\nb\\tc"}', creds.apiKey, 'fallback')).toBe('a b c')
  })
})

describe('probe', () => {
  it('sends one capped completion to the configured model', async () => {
    const fetchMock = mockFetch(respond(200, { model: 'test/model-0613', choices: [{}] }))

    await expect(probe(creds)).resolves.toEqual({ model: 'test/model-0613' })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://provider.test/v1/chat/completions')
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${creds.apiKey}`)
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'test/model',
      max_tokens: 1,
    })
  })

  it('accepts an empty completion — max_tokens: 1 legitimately returns one', async () => {
    mockFetch(respond(200, { choices: [{ message: { content: '' } }] }))
    await expect(probe(creds)).resolves.toEqual({ model: 'test/model' })
  })

  it.each([
    [401, 'unauthorized'],
    [402, 'payment_required'],
    [429, 'rate_limited'],
    [404, 'model_rejected'],
    [503, 'unreachable'],
  ] as const)('turns HTTP %i into the %s state', async (status, reason) => {
    mockFetch(respond(status, { error: { message: 'provider says no' } }))

    await expect(probe(creds)).rejects.toMatchObject({
      name: 'ProviderError',
      reason,
      detail: 'provider says no',
      status,
    })
  })

  it('carries retry-after through, so a scheduler can honour it', async () => {
    mockFetch(respond(429, {}, { 'retry-after': '30' }))
    await expect(probe(creds)).rejects.toMatchObject({ retryAfterSeconds: 30 })
  })

  it('reads a 200 that is not a chat completion as an incompatible endpoint', async () => {
    mockFetch(respond(200, { hello: 'world' }))
    await expect(probe(creds)).rejects.toMatchObject({ reason: 'model_rejected' })
  })

  it('reads a connection failure as unreachable rather than throwing raw', async () => {
    mockFetch(new TypeError('fetch failed'))
    const err = await probe(creds).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as ProviderError).reason).toBe('unreachable')
  })
})

/*
 * Gemini reaches us through Google's OpenAI-compatible surface rather than an
 * adapter, so what is worth testing is the two places its behaviour differs
 * from a plain OpenAI response: an empty completion that is nonetheless a
 * success, and Google's own error envelope.
 */
describe('gemini via the OpenAI-compatible surface', () => {
  const gemini: ProviderCredentials = {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKey: 'AIzaSy-not-a-real-key',
    modelId: 'gemini-3.7-flash',
  }

  it('posts to the compat path with a bearer token', async () => {
    const fetchMock = mockFetch(respond(200, { choices: [{}] }))
    await probe(gemini)

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${gemini.apiKey}`)
  })

  it('counts a thinking model’s empty MAX_TOKENS reply as a healthy connection', async () => {
    // What a Gemini 3.x model actually returns for `max_tokens: 1`: HTTP 200,
    // with the single token spent on thinking before any answer is emitted.
    mockFetch(
      respond(200, {
        model: 'gemini-3.7-flash',
        choices: [{ finish_reason: 'MAX_TOKENS', message: { role: 'assistant', content: null } }],
      }),
    )

    await expect(probe(gemini)).resolves.toEqual({ model: 'gemini-3.7-flash' })
  })

  it('reads a message out of Google’s error envelope', async () => {
    mockFetch(
      respond(429, {
        error: {
          code: 429,
          message: 'Quota exceeded for quota metric.',
          status: 'RESOURCE_EXHAUSTED',
        },
      }),
    )

    await expect(probe(gemini)).rejects.toMatchObject({
      reason: 'rate_limited',
      detail: 'Quota exceeded for quota metric.',
    })
  })

  it('reads an unknown model as the model being wrong, not the key', async () => {
    mockFetch(
      respond(404, {
        error: { code: 404, message: 'models/nope is not found.', status: 'NOT_FOUND' },
      }),
    )

    await expect(probe(gemini)).rejects.toMatchObject({ reason: 'model_rejected' })
  })
})

describe('chat', () => {
  it('returns the content and the model the provider actually ran', async () => {
    mockFetch(
      respond(200, {
        model: 'test/model-0613',
        choices: [{ message: { content: '{"claims":[]}' } }],
        usage: { prompt_tokens: 12, completion_tokens: 3 },
      }),
    )

    await expect(chat(creds, { messages: [{ role: 'user', content: 'hi' }] })).resolves.toEqual({
      text: '{"claims":[]}',
      model: 'test/model-0613',
      usage: { promptTokens: 12, completionTokens: 3 },
    })
  })

  it('sends a JSON schema as response_format when one is given', async () => {
    const fetchMock = mockFetch(respond(200, { choices: [{ message: { content: '{}' } }] }))

    await chat(creds, {
      messages: [{ role: 'user', content: 'hi' }],
      jsonSchema: { name: 'extraction', schema: { type: 'object' } },
    })

    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string))
      .toMatchObject({
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'extraction', strict: true },
        },
      })
  })

  it('omits response_format entirely when no schema is given', async () => {
    const fetchMock = mockFetch(respond(200, { choices: [{ message: { content: 'x' } }] }))
    await chat(creds, { messages: [{ role: 'user', content: 'hi' }] })
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    ) as Record<string, unknown>
    expect(body).not.toHaveProperty('response_format')
  })

  it('treats a 200 with no message content as a compatibility failure', async () => {
    mockFetch(respond(200, { choices: [] }))
    await expect(chat(creds, { messages: [] })).rejects.toMatchObject({
      reason: 'model_rejected',
    })
  })

  it('does not retry — a 429 on someone else’s key is not ours to burn', async () => {
    const fetchMock = mockFetch(respond(429, {}))
    await expect(chat(creds, { messages: [] })).rejects.toMatchObject({ reason: 'rate_limited' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
