import { describe, expect, it } from 'vitest'
import type { ExtractedClaim } from '@/lib/ontology/extraction'
import type { SeedClaim, SeedEntity } from '@/lib/ontology/ground-truth'
import { coreDirections, combineScores, rates, scoreDocument } from './score'

/**
 * A miniature seed: four paragraphs, a handful of entities, and one ground-truth
 * claim per rule the scorer has to get right. Each test varies the extraction.
 */

const P = [
  'The Shroud was created by Syrath in the war’s last winter.',
  'Prince Lukas married Princess Edith in 935, and the Empire rules Thalgia.',
  'Population roughly 2.9 million. The Empire was founded in 918.',
  'The Akali Archipelago is a cluster of islands. The Shroud is mentioned here too.',
]
const paragraphs = P.map((text, index) => ({ index, text }))

const entities: SeedEntity[] = [
  { name: 'Shroud', type: 'artifact' },
  { name: 'Syrath', type: 'character' },
  { name: 'Lukas', type: 'character' },
  { name: 'Edith', type: 'character' },
  { name: 'Kaldian Empire', type: 'society', variants: ['Empire'] },
  { name: 'Thalgia', type: 'region' },
  { name: 'Akál', type: 'region', variants: ['Akali Archipelago'] },
]

const truth: SeedClaim[] = [
  { subject: 'Shroud', predicate: 'created_by', object: 'Syrath', quote: P[0]!, paragraph: 0 },
  { subject: 'Lukas', predicate: 'married_to', object: 'Edith', startTime: '935', quote: 'Prince Lukas married Princess Edith in 935', paragraph: 1 },
  { subject: 'Kaldian Empire', predicate: 'rules', object: 'Thalgia', quote: 'the Empire rules Thalgia', paragraph: 1 },
  { subject: 'Kaldian Empire', predicate: 'population', value: 2_900_000, quote: 'Population roughly 2.9 million', paragraph: 2 },
  { subject: 'Kaldian Empire', predicate: 'founded_on', value: '918', quote: 'The Empire was founded in 918', paragraph: 2 },
  { subject: 'Akál', predicate: 'landform', value: 'archipelago', quote: 'The Akali Archipelago is a cluster of islands', paragraph: 3 },
  { subject: 'Shroud', predicate: 'located_in', object: 'Akál', handEntered: 'not in any document' },
]

/** One extracted claim for each truth claim above (bar the hand-entered one), each fully right. */
const perfect: ExtractedClaim[] = [
  { subjectName: 'Syrath', subjectType: 'character', predicate: 'created', objectName: 'Shroud', objectType: 'artifact', quote: 'created by Syrath', paragraphIndex: 0 },
  { subjectName: 'Edith', subjectType: 'character', predicate: 'married_to', objectName: 'Lukas', objectType: 'character', startTime: '935', quote: 'Prince Lukas married Princess Edith in 935' },
  { subjectName: 'Thalgia', subjectType: 'region', predicate: 'ruled_by', objectName: 'the Kaldian Empire', objectType: 'society', quote: 'the Empire rules Thalgia' },
  { subjectName: 'Kaldian Empire', subjectType: 'society', predicate: 'population', valueInt: 2_900_000, quote: 'Population roughly 2.9 million' },
  { subjectName: 'Empire', subjectType: 'society', predicate: 'founded_on', valueTime: '918 AD', quote: 'founded in 918' },
  { subjectName: 'Akali Archipelago', subjectType: 'region', predicate: 'landform', valueString: 'archipelago', quote: 'Akali Archipelago is a cluster' },
]

const score = (extracted: ExtractedClaim[]) => scoreDocument({ paragraphs, extracted, truth, entities })
const outcomes = (extracted: ExtractedClaim[]) => score(extracted).truth.map((t) => t.outcome)
const replace = (i: number, over: Partial<ExtractedClaim>) => perfect.map((c, j) => (j === i ? { ...c, ...over } : c))

describe('matching facts', () => {
  it('matches every claim of a perfect extraction, whichever direction or name form it used', () => {
    const result = score(perfect)
    expect(result.truth.map((t) => t.outcome)).toEqual(Array(6).fill('matched'))
    expect(result.extracted.map((e) => e.outcome)).toEqual(Array(6).fill('matched'))
    expect(rates(result.total)).toMatchObject({ precision: 1, recall: 1, f1: 1 })
  })

  it('drops hand-entered seed claims from the ground truth', () => {
    expect(score([]).total.truth).toBe(6)
  })

  it('counts an inverse pair under the direction the registry declares', () => {
    const result = score(perfect)
    expect(result.truth[0]!.predicate).toBe('created')
    expect(Object.keys(result.byPredicate).sort()).toEqual(['created', 'founded_on', 'landform', 'married_to', 'population', 'rules'])
  })

  it('does not match a non-symmetric relationship read backwards', () => {
    const backwards = replace(0, { subjectName: 'Shroud', subjectType: 'artifact', objectName: 'Syrath', objectType: 'character' })
    expect(outcomes(backwards)[0]).toBe('missed')
  })

  it('requires the entity type to agree, and says so when it is the only difference', () => {
    const result = score(replace(2, { objectType: 'faction' }))
    expect(result.truth[2]!.outcome).toBe('missed')
    expect(result.truth[2]!.nearMiss).toEqual({ extracted: 2, reason: 'Kaldian Empire is a society — extracted as faction' })
    expect(result.extracted[2]!.outcome).toBe('unmatched')
  })

  it('compares values by meaning: numbers numerically, dates by ordinal, text on the name key', () => {
    expect(outcomes(replace(3, { valueInt: 2_900_001 }))[3]).toBe('missed')
    expect(outcomes(replace(4, { valueTime: '919' }))[4]).toBe('missed')
    expect(outcomes(replace(5, { valueString: 'Archipelago' }))[5]).toBe('matched')
    expect(outcomes(replace(5, { valueString: 'island' }))[5]).toBe('missed')
  })

  it('does not match a value on the wrong subject', () => {
    expect(outcomes(replace(3, { subjectName: 'Thalgia', subjectType: 'region' }))[3]).toBe('missed')
  })
})

describe('grading the citation', () => {
  it('reports a right fact with a paraphrased quote, and does not count it as matched', () => {
    const result = score(replace(0, { quote: 'Syrath made the Shroud' }))
    expect(result.truth[0]!.outcome).toBe('quote_paraphrased')
    expect(result.extracted[0]!).toMatchObject({ outcome: 'quote_paraphrased', verbatim: false })
    expect(result.total).toMatchObject({ matched: 5, factMatched: 6 })
    expect(rates(result.total)).toMatchObject({ recall: 5 / 6, factRecall: 1 })
  })

  it('reports a verbatim quote from another passage separately', () => {
    const result = score(replace(0, { quote: 'The Shroud is mentioned here too.' }))
    expect(result.truth[0]!.outcome).toBe('quote_elsewhere')
  })

  it('accepts straightened quote marks', () => {
    expect(outcomes(replace(0, { quote: "in the war's last winter" }))[0]).toBe('matched')
  })
})

describe('duplicates', () => {
  it('scores the best-cited copy of a repeated fact and keeps the rest out of precision', () => {
    const poor = { ...perfect[0]!, quote: 'Syrath made it' }
    const result = score([poor, ...perfect])
    expect(result.truth[0]).toMatchObject({ outcome: 'matched', extracted: 1 })
    expect(result.extracted[0]).toMatchObject({ outcome: 'duplicate', duplicateOf: 1 })
    expect(result.total.extracted).toBe(6)
  })

  it('treats a relationship stated in both directions as one fact', () => {
    const both = [...perfect, { ...perfect[0]!, subjectName: 'Shroud', subjectType: 'artifact', predicate: 'created_by', objectName: 'Syrath', objectType: 'character' }]
    expect(score(both).extracted.at(-1)!.outcome).toBe('duplicate')
  })

  it('collapses repeated unknown facts too', () => {
    const stray: ExtractedClaim = { subjectName: 'Nowhere', subjectType: 'region', predicate: 'landform', valueString: 'plain', quote: 'x' }
    const result = score([...perfect, stray, { ...stray }])
    expect(result.extracted.slice(-2).map((e) => e.outcome)).toEqual(['unmatched', 'duplicate'])
    expect(rates(result.total).precision).toBe(6 / 7)
  })
})

describe('times', () => {
  it('compares start and end on right facts without affecting the match', () => {
    const result = score(replace(1, { startTime: '936' }))
    expect(result.truth[1]).toMatchObject({ outcome: 'matched', timesAgree: false })
    expect(result.times).toEqual({ compared: 6, agree: 5, dated: 1, datedAgree: 0 })
  })

  it('counts a time the model invented as a disagreement', () => {
    expect(score(replace(2, { startTime: '935' })).truth[2]!.timesAgree).toBe(false)
  })
})

describe('totals', () => {
  it('sums documents and computes rates over the sum', () => {
    const a = score(perfect)
    const b = score([])
    const combined = combineScores([a, b])
    expect(combined.total).toEqual({ truth: 12, extracted: 6, matched: 6, factMatched: 6 })
    expect(combined.byPredicate.rules).toEqual({ truth: 2, extracted: 1, matched: 1, factMatched: 1 })
    expect(rates(combined.total)).toMatchObject({ precision: 1, recall: 0.5 })
  })

  it('leaves a rate null when there is nothing to divide by', () => {
    expect(rates(score([]).total)).toMatchObject({ precision: null, recall: 0, f1: null })
  })

  it('uses the core vocabulary’s declared directions', () => {
    const d = coreDirections()
    expect(d.get('ruled_by')).toMatchObject({ canonical: 'rules', flipped: true })
    expect(d.get('rules')).toMatchObject({ canonical: 'rules', flipped: false })
    expect(d.get('married_to')).toMatchObject({ canonical: 'married_to', symmetric: true, flipped: false })
    expect(d.get('population')).toMatchObject({ canonical: 'population', flipped: false })
  })
})
