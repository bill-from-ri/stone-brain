import { describe, expect, it } from 'vitest'
import {
  genericDifference,
  genericKey,
  pluralKey,
  pluralPair,
  sameWordsReordered,
  splitTitles,
  titleDifference,
  titleKey,
  variantsToAdd,
  wordSetKey,
} from './names'

describe('plural', () => {
  it('reads -s, -es and -ies as plurals, on the same key', () => {
    expect(pluralPair('giants', 'Giant')).toEqual([['giants', 'giant']])
    expect(pluralPair('Boxes', 'Box')).toEqual([['boxes', 'box']])
    expect(pluralPair('Free Cities', 'Free City')).toEqual([['cities', 'city']])
    expect(pluralKey('giants')).toBe(pluralKey('Giant'))
    expect(pluralKey('Houses')).toBe(pluralKey('House'))
    expect(pluralKey('Free Cities')).toBe(pluralKey('free city'))
  })

  it('leaves short words, identical names and other differences alone', () => {
    expect(pluralPair('Gas', 'Ga')).toBeNull()
    expect(pluralPair('Giant', 'giant')).toBeNull()
    expect(pluralPair('Rose', 'Ros')).toBeNull()
    expect(pluralPair('Giants', 'Giant Kings')).toBeNull()
    expect(pluralPair('1st Legion', '11th Legion')).toBeNull()
  })
})

describe('title', () => {
  it('takes leading titles off a name, never the whole name', () => {
    expect(splitTitles('Count Aldo Demard')).toEqual({ titles: ['count'], rest: ['aldo', 'demard'] })
    expect(splitTitles('Lord Captain Orin')).toEqual({ titles: ['lord', 'captain'], rest: ['orin'] })
    expect(splitTitles('King')).toEqual({ titles: [], rest: ['king'] })
    expect(titleKey('Count Aldo Demard')).toBe(titleKey('Aldo Demard'))
  })

  it('names the title when exactly one side carries one', () => {
    expect(titleDifference('Count Aldo Demard', 'Aldo Demard')).toEqual({ titled: 'a', titles: ['Count'] })
    expect(titleDifference('Aldo Demard', 'Count Aldo Demard')).toEqual({ titled: 'b', titles: ['Count'] })
    expect(titleDifference('King Albert', 'Prince Albert')).toBeNull()
  })

  it('does not treat Saint as a title', () => {
    expect(titleDifference('St Leir', 'Leir')).toBeNull()
    expect(titleDifference('Saint Leir', 'Leir')).toBeNull()
  })
})

describe('word order', () => {
  it('matches the same words reordered, of and the ignored', () => {
    expect(sameWordsReordered('Innenbeck Province', 'Province of Innenbeck')).toBe(true)
    expect(wordSetKey('Innenbeck Province')).toBe(wordSetKey('the Province of Innenbeck'))
  })

  it('does not call one name, or one word, a reordering', () => {
    expect(sameWordsReordered('Lanzhelm', 'Lanzhelm')).toBe(false)
    expect(sameWordsReordered('Sea of Tears', 'Sea Tears')).toBe(false)
    expect(sameWordsReordered('Kaldian Vale', 'Kaldian Empire')).toBe(false)
  })
})

describe('generic word', () => {
  it('matches a name with generic place words added', () => {
    expect(genericDifference('Interior Basin', 'Interior')).toEqual({ extended: 'a', words: ['Basin'] })
    expect(genericDifference('Ashfall', 'Kingdom of Ashfall')).toEqual({ extended: 'b', words: ['Kingdom'] })
    expect(genericKey('Interior Basin')).toBe(genericKey('Interior'))
  })

  it('needs one side bare', () => {
    expect(genericDifference('Kaldian Vale', 'Kaldian Empire')).toBeNull()
    expect(genericDifference('Province', 'Province')).toBeNull()
    expect(genericDifference('House Lanzhelm', 'Lanzhelm')).toBeNull()
  })
})

describe('variantsToAdd', () => {
  it("adds the dropped name and its variants, less what the survivor already answers to", () => {
    expect(
      variantsToAdd(
        { name: 'Aldo Demard', nameVariants: ['Aldo'] },
        { name: 'Count Aldo Demard', nameVariants: ['aldo', 'The Count', 'the count', 'Aldo Demard.'] },
      ),
    ).toEqual(['Count Aldo Demard', 'The Count'])
  })
})
