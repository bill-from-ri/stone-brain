import { describe, expect, it } from 'vitest'
import { inverseOf, inversePredicate } from './inverse'
import { deriveOntology } from './registry'

const SERA = '00000000-0000-4000-8000-000000000001'
const ASHFALL = '00000000-0000-4000-8000-000000000002'
const USER = '00000000-0000-4000-8000-0000000000aa'

const rules = {
  userId: USER,
  subjectId: SERA,
  subjectType: 'character',
  predicate: 'rules',
  objectId: ASHFALL,
  objectType: 'settlement',
}

describe('inverseOf', () => {
  it('swaps the ends and takes the declared inverse predicate', () => {
    expect(inverseOf(rules)).toEqual({
      userId: USER,
      subjectId: ASHFALL,
      subjectType: 'settlement',
      predicate: 'ruled_by',
      objectId: SERA,
      objectType: 'character',
    })
  })

  it('inverts an inverse back to the original', () => {
    const back = inverseOf(inverseOf(rules)! as Parameters<typeof inverseOf>[0])
    expect(back).toMatchObject(rules)
  })

  it('treats a symmetric predicate as its own inverse', () => {
    const inverse = inverseOf({ ...rules, predicate: 'married_to', objectType: 'character' })
    expect(inverse).toMatchObject({
      predicate: 'married_to',
      subjectId: ASHFALL,
      objectId: SERA,
    })
  })

  it('carries the time bounds and provenance over', () => {
    const inverse = inverseOf({
      ...rules,
      startTime: '400 AD',
      startOrder: 400,
      endTime: '412 AD',
      endOrder: 412,
      canonicity: 'draft',
      createdBy: 'llm',
      extractedByModel: 'test/model',
    })

    expect(inverse).toMatchObject({
      startTime: '400 AD',
      startOrder: 400,
      endTime: '412 AD',
      endOrder: 412,
      canonicity: 'draft',
      createdBy: 'llm',
      extractedByModel: 'test/model',
    })
  })

  it('omits absent fields rather than writing nulls over column defaults', () => {
    const inverse = inverseOf({ ...rules, startTime: null, canonicity: undefined })
    expect(inverse).not.toHaveProperty('startTime')
    expect(inverse).not.toHaveProperty('canonicity')
  })

  it('never copies the row identity', () => {
    const row = { ...rules, id: 'claim-1', fingerprint: 'x', createdAt: new Date() }
    const inverse = inverseOf(row)!
    expect(inverse).not.toHaveProperty('id')
    expect(inverse).not.toHaveProperty('fingerprint')
    expect(inverse).not.toHaveProperty('createdAt')
  })

  it('returns null for an attribute', () => {
    expect(
      inverseOf({ ...rules, predicate: 'population', objectId: null, objectType: null }),
    ).toBeNull()
  })

  it('returns null for a predicate with no inverse, or one it does not know', () => {
    const vocabulary = new Map([['knows_of', { kind: 'relationship', inverseName: null }]])
    expect(inverseOf({ ...rules, predicate: 'knows_of' }, vocabulary)).toBeNull()
    expect(inverseOf({ ...rules, predicate: 'not_a_predicate' })).toBeNull()
  })

  it('reads the vocabulary it is given', () => {
    const vocabulary = new Map([['rules', { kind: 'relationship', inverseName: 'governed_by' }]])
    expect(inverseOf(rules, vocabulary)?.predicate).toBe('governed_by')
  })

  it('finds an inverse for every relationship in the registry', () => {
    // The invariant only holds if no relationship is left one-directional.
    for (const p of deriveOntology().predicates.filter((p) => p.kind === 'relationship')) {
      expect(inversePredicate(p.name), p.name).not.toBeNull()
    }
  })
})

describe('inversePredicate', () => {
  it('names the reverse verb, or null for an attribute', () => {
    expect(inversePredicate('rules')).toBe('ruled_by')
    expect(inversePredicate('ruled_by')).toBe('rules')
    expect(inversePredicate('married_to')).toBe('married_to')
    expect(inversePredicate('population')).toBeNull()
  })
})
