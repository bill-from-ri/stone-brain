import { describe, expect, it } from 'vitest'
import {
  compareSurvivor,
  detectDuplicates,
  duplicateKey,
  findDuplicatePairs,
  type DetectableEntity,
} from './detect'

let next = 0
function e(name: string, entityType: string, more: Partial<DetectableEntity> = {}): DetectableEntity {
  next++
  return {
    id: `id-${String(next).padStart(3, '0')}`,
    name,
    entityType,
    nameVariants: [],
    canonicity: 'draft',
    createdBy: 'llm',
    claimCount: 0,
    createdAt: new Date(2026, 0, 1, 0, 0, next),
    ...more,
  }
}

const names = (found: ReturnType<typeof findDuplicatePairs>) =>
  found.map((d) => [d.entities[0].name, d.entities[1].name, d.reasons.map((r) => r.code)])

describe('the four merges made by hand', () => {
  it('finds each, with the survivor that was kept', () => {
    const entities = [
      e('giants', 'species'),
      e('Giant', 'species', { createdBy: 'seed', canonicity: 'canon' }),
      e('Interior Basin', 'region'),
      e('Interior', 'region', { createdBy: 'seed' }),
      e('Count Aldo Demard', 'character'),
      e('Aldo Demard', 'character', { claimCount: 4 }),
      e('Innenbeck Province', 'region'),
      e('Province of Innenbeck', 'society', { createdBy: 'seed' }),
    ]
    const found = findDuplicatePairs(entities)
    expect(names(found).sort()).toEqual(
      [
        ['Aldo Demard', 'Count Aldo Demard', ['title']],
        ['Giant', 'giants', ['plural']],
        ['Interior', 'Interior Basin', ['generic_word']],
        ['Province of Innenbeck', 'Innenbeck Province', ['word_order']],
      ].sort(),
    )
    expect(found.find((d) => d.reasons[0]!.code === 'word_order')!.crossType).toBe(true)
  })

  it('explains each reason in words', () => {
    const [count] = findDuplicatePairs([e('Count Aldo Demard', 'character'), e('Aldo Demard', 'character')])
    expect(count!.reasons[0]!.text).toBe('“Count Aldo Demard” is “Aldo Demard” with the title “Count”.')
    const [basin] = findDuplicatePairs([e('Interior Basin', 'region'), e('Interior', 'region')])
    expect(basin!.reasons[0]!.text).toBe('“Interior Basin” is “Interior” with “Basin” added.')
  })
})

describe('what is not a duplicate', () => {
  it('leaves near-names alone', () => {
    expect(
      findDuplicatePairs([
        e('House Lanzhelm', 'faction'),
        e('Lanzhelm', 'settlement'),
        e('Kaldian Vale', 'region'),
        e('Kaldian Empire', 'society'),
        e('Kaldian Empire', 'region'),
        e('1st Legion', 'faction'),
        e('11th Legion', 'faction'),
        e('St Leir', 'settlement'),
        e('Leir', 'settlement'),
      ]),
    ).toEqual([])
  })

  it('never pairs two canon entities', () => {
    expect(
      findDuplicatePairs([e('giants', 'species', { canonicity: 'canon' }), e('Giant', 'species', { canonicity: 'canon' })]),
    ).toEqual([])
  })

  it('applies the fuzzy rules within one type only', () => {
    expect(findDuplicatePairs([e('Interior Basin', 'region'), e('Interior', 'society')])).toEqual([])
    expect(findDuplicatePairs([e('Count Aldo', 'character'), e('Aldo', 'deity')])).toEqual([])
    expect(findDuplicatePairs([e('Giants', 'species'), e('Giant', 'character')])).toEqual([])
  })

  it('lets one name stand for two types', () => {
    expect(findDuplicatePairs([e('Lanzhelm', 'faction'), e('Lanzhelm', 'settlement')])).toEqual([])
  })
})

describe('variants', () => {
  it('pairs a name with another entity’s recorded variant, across types', () => {
    const found = findDuplicatePairs([
      e('The Veche', 'faction'),
      e('Assembly', 'society', { nameVariants: ['Veche'] }),
    ])
    expect(names(found)).toEqual([['The Veche', 'Assembly', ['variant']]])
    expect(found[0]!.reasons[0]!.text).toBe('“The Veche” is recorded as another name for “Assembly”.')
  })

  it('pairs two entities of one type under one name', () => {
    expect(names(findDuplicatePairs([e('Ashfall', 'settlement'), e('ashfall', 'settlement')]))).toEqual([
      ['Ashfall', 'ashfall', ['variant']],
    ])
  })

  it('reports a pair once, however many rules bucket it', () => {
    const found = findDuplicatePairs([
      e('Count Aldo Demard', 'character'),
      e('Aldo Demard', 'character', { nameVariants: ['Count Aldo Demard'] }),
    ])
    expect(found).toHaveLength(1)
    expect(found[0]!.reasons.map((r) => r.code)).toEqual(['variant', 'title'])
  })
})

describe('the suggested survivor', () => {
  it('prefers canon, then hand-made, then more claims, then the elder', () => {
    const elder = e('A', 'region')
    const younger = e('B', 'region')
    expect(compareSurvivor(elder, younger)).toBeLessThan(0)
    expect(compareSurvivor({ ...younger, claimCount: 2 }, elder)).toBeLessThan(0)
    expect(compareSurvivor({ ...younger, createdBy: 'user' }, { ...elder, claimCount: 9 })).toBeLessThan(0)
    expect(compareSurvivor({ ...younger, canonicity: 'canon' }, { ...elder, createdBy: 'seed' })).toBeLessThan(0)
  })
})

describe('ranking', () => {
  it('puts stronger reasons first, then more shared neighbours', () => {
    const basinA = e('Interior Basin', 'region')
    const basinB = e('Interior', 'region')
    const marchA = e('Eastern March', 'region')
    const marchB = e('Eastern', 'region')
    const giantA = e('giants', 'species')
    const giantB = e('Giant', 'species')
    const town = e('Gabelford', 'settlement')

    const ranked = detectDuplicates(
      [basinA, basinB, marchA, marchB, giantA, giantB, town],
      [
        { subjectId: town.id, objectId: marchA.id },
        { subjectId: marchB.id, objectId: town.id },
        // An edge between the pair is not a shared neighbour.
        { subjectId: basinA.id, objectId: basinB.id },
      ],
    )
    expect(ranked.map((d) => d.key)).toEqual([
      duplicateKey(giantA.id, giantB.id),
      duplicateKey(marchA.id, marchB.id),
      duplicateKey(basinA.id, basinB.id),
    ])
    expect(ranked[1]!.sharedNeighbourIds).toEqual([town.id])
    expect(ranked[2]!.sharedNeighbourIds).toEqual([])
  })

  it('keys a pair the same whichever way round it is found', () => {
    expect(duplicateKey('b', 'a')).toBe('a|b')
    expect(duplicateKey('a', 'b')).toBe('a|b')
  })
})
