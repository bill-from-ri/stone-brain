import { describe, expect, it, vi } from 'vitest'
import type { DriveClient } from '@/lib/drive/client'
import { estimateTokens, fitsInContext, readDocumentText } from './text'

/** A DriveClient stand-in with only the two methods this module calls. */
function fakeClient(markdown: string, headRevisionId: string | null = 'r9') {
  const calls: string[] = []
  return {
    calls,
    client: {
      exportMarkdown: vi.fn(async () => {
        calls.push('export')
        return markdown
      }),
      getHeadRevisionId: vi.fn(async () => {
        calls.push('revision')
        return headRevisionId
      }),
    } as unknown as DriveClient,
  }
}

describe('readDocumentText', () => {
  it('returns the cleaned text, its paragraphs and the revision as one set', async () => {
    const { client } = fakeClient('# Andras\n\nAn aristocratic republic.\n')

    const result = await readDocumentText(client, 'file-1')

    expect(result.markdown).toBe('# Andras\n\nAn aristocratic republic.')
    expect(result.paragraphs.map((p) => p.text)).toEqual(['# Andras', 'An aristocratic republic.'])
    expect(result.headRevisionId).toBe('r9')
  })

  it('reads the revision BEFORE the export', async () => {
    // Load-bearing ordering, not incidental: an edit landing between the two
    // calls must make the document look stale (one wasted re-extraction) rather
    // than current (claims pinned to a revision that never contained them).
    const { client, calls } = fakeClient('Body.')
    await readDocumentText(client, 'file-1')
    expect(calls).toEqual(['revision', 'export'])
  })

  it('tolerates a document Drive reports no revisions for', async () => {
    const { client } = fakeClient('Body.', null)
    await expect(readDocumentText(client, 'file-1')).resolves.toMatchObject({
      headRevisionId: null,
    })
  })

  it('reports what the image strip actually saved', async () => {
    const payload = `[image1]: <data:image/png;base64,${'A'.repeat(5000)}>`
    const { client } = fakeClient(`Body.\n\n${payload}`)

    const result = await readDocumentText(client, 'file-1')
    expect(result.markdown).toBe('Body.')
    expect(result.strippedBytes).toBeGreaterThan(5000)
  })
})

describe('fitsInContext', () => {
  it('passes the largest document in the corpus with room to spare', () => {
    // Central Empire: 81,308 characters cleaned, about 20k tokens.
    expect(fitsInContext('x'.repeat(81_308))).toBe(true)
  })

  it('passes the entire corpus concatenated, which is why there is no chunker', () => {
    expect(estimateTokens('x'.repeat(373_668))).toBeLessThan(100_000)
  })

  it('rejects a document that would not fit, rather than truncating it', () => {
    // A truncated extraction looks exactly like a document with fewer claims,
    // which is the failure this guard exists to make loud.
    expect(fitsInContext('x'.repeat(600_000))).toBe(false)
  })

  it('takes the context size from the caller when it is known', () => {
    const text = 'x'.repeat(440_000) // ~110k tokens, over the 104k budget a
    //                                  128k window leaves after overhead
    expect(fitsInContext(text, 128_000)).toBe(false)
    expect(fitsInContext(text, 1_000_000)).toBe(true)
  })
})
