import { describe, expect, it } from 'vitest'
import { MIN_SHARED_CHARS, locateQuote, normalizeQuoteText, spansOverlap } from './quotes'

const paragraphs = [
  { index: 0, text: '# The Empire' },
  { index: 1, text: 'The Dragon’s Shroud  is a wall\nof fog. The Empire lies within it.' },
  { index: 2, text: 'Beyond the Empire, the sea.' },
]

describe('locateQuote', () => {
  it('forgives straightened quote marks and reflowed whitespace', () => {
    expect(locateQuote("Dragon's Shroud is a wall of fog", paragraphs)).toEqual([
      { paragraph: 1, start: 4, end: 36 },
    ])
  })

  it('finds every occurrence, across paragraphs', () => {
    expect(locateQuote('Empire', paragraphs).map((s) => s.paragraph)).toEqual([0, 1, 2])
  })

  it('forgives nothing else: a changed word or an ellipsis is a paraphrase', () => {
    expect(locateQuote('The Dragon’s Shroud is a wall of mist', paragraphs)).toEqual([])
    expect(locateQuote('The Dragon’s Shroud … of fog', paragraphs)).toEqual([])
    expect(locateQuote('the dragon’s shroud', paragraphs)).toEqual([])
  })

  it('finds nothing for an empty quote', () => {
    expect(locateQuote('   ', paragraphs)).toEqual([])
  })

  it('normalises curly double quotes too', () => {
    expect(normalizeQuoteText('“Unite  the realms.”')).toBe('"Unite the realms."')
  })
})

describe('spansOverlap', () => {
  const span = (paragraph: number, start: number, end: number) => [{ paragraph, start, end }]

  it('accepts a quote inside the ground truth’s, or straddling it', () => {
    expect(spansOverlap(span(1, 10, 30), span(1, 0, 100))).toBe(true)
    expect(spansOverlap(span(1, 0, 30), span(1, 15, 60))).toBe(true)
  })

  it('rejects the same offsets in another paragraph', () => {
    expect(spansOverlap(span(1, 0, 30), span(2, 0, 30))).toBe(false)
  })

  it('rejects neighbours that only touch', () => {
    expect(spansOverlap(span(1, 0, 30), span(1, 30 - MIN_SHARED_CHARS + 1, 60))).toBe(false)
    expect(spansOverlap(span(1, 0, 30), span(1, 30, 60))).toBe(false)
  })

  it('lets a quote shorter than the threshold overlap by being wholly shared', () => {
    expect(spansOverlap(span(1, 5, 11), span(1, 0, 40))).toBe(true)
  })

  it('accepts when any occurrence overlaps', () => {
    const extracted = [...span(0, 0, 12), ...span(2, 0, 12)]
    expect(spansOverlap(extracted, span(2, 0, 27))).toBe(true)
  })
})
