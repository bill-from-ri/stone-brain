import { describe, expect, it } from 'vitest'
import { toParagraphs } from './markdown'

describe('paragraph anchoring', () => {
  it('splits on blank lines and drops the gaps', () => {
    expect(toParagraphs('One.\n\nTwo.\n\n\n\nThree.')).toEqual(['One.', 'Two.', 'Three.'])
  })

  it('keeps a wrapped paragraph whole', () => {
    expect(toParagraphs('A line\nand its continuation.\n\nNext.')).toEqual([
      'A line\nand its continuation.',
      'Next.',
    ])
  })

  it('survives CRLF, which Drive exports sometimes carry', () => {
    expect(toParagraphs('One.\r\n\r\nTwo.')).toEqual(['One.', 'Two.'])
  })

  it('ignores whitespace-only separators', () => {
    expect(toParagraphs('One.\n   \nTwo.')).toEqual(['One.', 'Two.'])
  })

  it('returns nothing for an empty document rather than one empty paragraph', () => {
    expect(toParagraphs('')).toEqual([])
    expect(toParagraphs('\n\n   \n')).toEqual([])
  })
})
