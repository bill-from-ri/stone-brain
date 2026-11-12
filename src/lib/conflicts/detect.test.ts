import { describe, expect, it } from 'vitest'
import { ordinalFor } from '@/lib/ontology/calendar'
import {
  conflictId,
  detectValueConflicts,
  findMirrors,
  isValueConflictDismissed,
  pairDirections,
  valueConflictKey,
  type DetectableClaim,
  type PairableClaim,
} from './detect'
import { sameValue } from './values'

const ASHFALL = 'ashfall'

let seq = 0
/** A `ruled_by` claim on Ashfall, naming a ruler and optionally dates. */
function ruledBy(ruler: string, start?: string, end?: string, over: Partial<DetectableClaim> = {}): DetectableClaim {
  return {
    id: `c${String(++seq).padStart(3, '0')}`,
    subjectId: ASHFALL,
    predicate: 'ruled_by',
    objectId: ruler,
    objectType: 'character',
    isTemporal: true,
    valueString: null,
    valueInt: null,
    valueFloat: null,
    valueTime: null,
    valueOrder: null,
    startTime: start ?? null,
    startOrder: start ? ordinalFor(start) : null,
    endTime: end ?? null,
    endOrder: end ? ordinalFor(end) : null,
    ...over,
  }
}

function attribute(predicate: string, value: Partial<DetectableClaim>, over: Partial<DetectableClaim> = {}): DetectableClaim {
  return {
    ...ruledBy('-', undefined, undefined, { predicate, objectId: null, objectType: null, isTemporal: false }),
    subjectId: 'sera',
    ...value,
    ...over,
  }
}

const ids = (claims: { id: string }[]) => claims.map((c) => c.id)

describe('detectValueConflicts', () => {
  it('finds two undated rulers of one city', () => {
    const a = ruledBy('sera')
    const b = ruledBy('orin')
    const [conflict, ...rest] = detectValueConflicts([a, b])

    expect(rest).toEqual([])
    expect(conflict!.subjectId).toBe(ASHFALL)
    expect(conflict!.predicate).toBe('ruled_by')
    expect(conflict!.sides.map((s) => ids(s.claims))).toEqual([[a.id], [b.id]])
    expect(conflict!.sides.map((s) => s.displaces)).toEqual([[b.id], [a.id]])
  })

  it('makes N disagreeing claims one conflict with N sides', () => {
    const claims = [ruledBy('sera'), ruledBy('orin'), ruledBy('vaski')]
    const found = detectValueConflicts(claims)
    expect(found).toHaveLength(1)
    expect(found[0]!.sides).toHaveLength(3)
    expect(found[0]!.key).toBe(valueConflictKey(ASHFALL, 'ruled_by', ids(claims)))
  })

  it('does not raise a succession', () => {
    expect(detectValueConflicts([ruledBy('sera', 'AD 400', 'AD 412'), ruledBy('orin', 'AD 412', 'AD 430')])).toEqual([])
  })

  it('raises overlapping reigns', () => {
    expect(detectValueConflicts([ruledBy('sera', 'AD 400', 'AD 420'), ruledBy('orin', 'AD 410', 'AD 430')])).toHaveLength(1)
  })

  it('does not raise one dated reign against one undated', () => {
    expect(detectValueConflicts([ruledBy('sera', 'AD 400', 'AD 412'), ruledBy('orin')])).toEqual([])
  })

  it('does not raise the same ruler restated with different dates', () => {
    expect(detectValueConflicts([ruledBy('sera', 'AD 400', 'AD 412'), ruledBy('sera', 'AD 405', 'AD 420'), ruledBy('sera')])).toEqual([])
  })

  it('groups claims giving the same answer into one side', () => {
    const a1 = ruledBy('sera')
    const a2 = ruledBy('sera', 'AD 400', 'AD 420')
    const b = ruledBy('orin', 'AD 410', 'AD 415')
    const [conflict] = detectValueConflicts([a1, a2, b])

    // a1 (undated) and b (dated) do not disagree, but a2 and b do, so a1 is
    // not drawn in: it is not part of the argument.
    expect(conflict!.sides.map((s) => ids(s.claims))).toEqual([[a2.id], [b.id]])
  })

  it('puts both claims of a restated answer on one side when both are contested', () => {
    const a1 = ruledBy('sera', 'AD 400', 'AD 420')
    const a2 = ruledBy('sera', 'AD 405', 'AD 425')
    const b = ruledBy('orin', 'AD 410', 'AD 415')
    const [conflict] = detectValueConflicts([a1, a2, b])

    expect(conflict!.sides.map((s) => ids(s.claims))).toEqual([[a1.id, a2.id], [b.id]])
    expect(conflict!.sides[1]!.displaces).toEqual([a1.id, a2.id])
  })

  it('keeps a chain as one conflict but displaces only what actually disagrees', () => {
    // A overlaps B, B overlaps C, A and C are a clean succession.
    const a = ruledBy('sera', 'AD 400', 'AD 420')
    const b = ruledBy('orin', 'AD 410', 'AD 440')
    const c = ruledBy('vaski', 'AD 430', 'AD 450')
    const [conflict, ...rest] = detectValueConflicts([a, b, c])

    expect(rest).toEqual([])
    const bySide = Object.fromEntries(conflict!.sides.map((s) => [s.claims[0]!.id, s.displaces]))
    expect(bySide[a.id]).toEqual([b.id])
    expect(bySide[b.id]).toEqual([a.id, c.id])
    expect(bySide[c.id]).toEqual([b.id])
  })

  it('finds separate conflicts in separate periods of one subject', () => {
    const found = detectValueConflicts([
      ruledBy('sera', 'AD 100', 'AD 120'),
      ruledBy('orin', 'AD 110', 'AD 130'),
      ruledBy('vaski', 'AD 500', 'AD 520'),
      ruledBy('enua', 'AD 510', 'AD 530'),
    ])
    expect(found).toHaveLength(2)
  })

  it('never compares objects of different entity types', () => {
    // A duke and his duchy both rule the town: layered sovereignty, not a contradiction.
    expect(detectValueConflicts([ruledBy('duke'), ruledBy('duchy', undefined, undefined, { objectType: 'society' })])).toEqual([])
  })

  it('never compares different subjects or different predicates', () => {
    expect(detectValueConflicts([ruledBy('sera'), ruledBy('orin', undefined, undefined, { subjectId: 'gabelford' })])).toEqual([])
    expect(detectValueConflicts([ruledBy('sera'), ruledBy('orin', undefined, undefined, { predicate: 'led_by' })])).toEqual([])
  })

  it('ignores dates for a non-temporal predicate', () => {
    const born = (place: string, start?: string) =>
      ruledBy(place, start, undefined, { predicate: 'born_in', objectType: 'settlement', isTemporal: false })
    expect(detectValueConflicts([born('ashfall', 'AD 400'), born('gabelford')])).toHaveLength(1)
  })

  it('raises differing enum values', () => {
    const found = detectValueConflicts([
      attribute('vital_status', { valueString: 'alive' }),
      attribute('vital_status', { valueString: 'dead' }),
    ])
    expect(found).toHaveLength(1)
    expect(found[0]!.objectType).toBeNull()
  })

  it('reads date values on the calendar, not as text', () => {
    const date = (label: string) =>
      attribute('birth_date', { valueTime: label, valueOrder: ordinalFor(label) })

    expect(detectValueConflicts([date('AD 412'), date('412 AD')])).toEqual([])
    // A month inside the year agrees with the year.
    expect(detectValueConflicts([date('AD 412'), date('month 3, AD 412')])).toEqual([])
    expect(detectValueConflicts([date('AD 412'), date('AD 413')])).toHaveLength(1)
    expect(detectValueConflicts([date('month 3, AD 412'), date('month 4, AD 412')])).toHaveLength(1)
  })

  it('preserves input order, so the oldest answer comes first', () => {
    const b = ruledBy('orin')
    const a = ruledBy('sera')
    const [conflict] = detectValueConflicts([b, a])
    expect(conflict!.sides[0]!.claims[0]!.id).toBe(b.id)
  })
})

describe('sameValue', () => {
  const v = (over: object) => ({
    objectId: null, valueString: null, valueInt: null, valueFloat: null, valueTime: null, valueOrder: null, ...over,
  })

  it('compares text without case or spacing', () => {
    expect(sameValue(v({ valueString: 'Alive' }), v({ valueString: ' alive ' }))).toBe(true)
  })

  it('compares unplaceable dates by their words', () => {
    expect(sameValue(v({ valueTime: 'the Sundering' }), v({ valueTime: 'the sundering' }))).toBe(true)
    expect(sameValue(v({ valueTime: 'the Sundering' }), v({ valueTime: 'the flood' }))).toBe(false)
  })

  it('compares numbers exactly', () => {
    expect(sameValue(v({ valueInt: 3 }), v({ valueInt: 3 }))).toBe(true)
    expect(sameValue(v({ valueInt: 3 }), v({ valueInt: 4 }))).toBe(false)
  })
})

describe('dismissals', () => {
  const key = (...claimIds: string[]) => valueConflictKey(ASHFALL, 'ruled_by', claimIds)

  it('sorts claim ids so the key does not depend on order', () => {
    expect(key('b', 'a')).toBe(key('a', 'b'))
  })

  it('covers the exact set that was dismissed', () => {
    expect(isValueConflictDismissed(key('a', 'b'), [key('a', 'b')])).toBe(true)
  })

  it('re-opens when a new disagreeing claim arrives', () => {
    expect(isValueConflictDismissed(key('a', 'b', 'c'), [key('a', 'b')])).toBe(false)
  })

  it('stays dismissed when a side is removed from a dismissed set', () => {
    expect(isValueConflictDismissed(key('a', 'b'), [key('a', 'b', 'c')])).toBe(true)
  })

  it('does not leak across subjects or predicates', () => {
    expect(isValueConflictDismissed(key('a', 'b'), [valueConflictKey('gabelford', 'ruled_by', ['a', 'b'])])).toBe(false)
    expect(isValueConflictDismissed(key('a', 'b'), [valueConflictKey(ASHFALL, 'led_by', ['a', 'b'])])).toBe(false)
  })

  it('gives each conflict a short id that changes with its key', () => {
    expect(conflictId('value', key('a', 'b'))).toMatch(/^[\w-]{12}$/)
    expect(conflictId('value', key('a', 'b'))).toBe(conflictId('value', key('b', 'a')))
    expect(conflictId('value', key('a', 'b'))).not.toBe(conflictId('value', key('a', 'b', 'c')))
    expect(conflictId('value', 'x')).not.toBe(conflictId('vanished_source', 'x'))
  })
})

describe('pairDirections', () => {
  const rel = (id: string, subjectId: string, predicate: string, objectId: string, inverseName: string, over: Partial<PairableClaim> = {}): PairableClaim => ({
    id, subjectId, objectId, predicate, inverseName, startTime: null, endTime: null, ...over,
  })

  it('collapses a claim and its inverse into the declared direction', () => {
    const inverse = rel('1', 'ashfall', 'ruled_by', 'sera', 'rules')
    const forward = rel('2', 'sera', 'rules', 'ashfall', 'ruled_by')
    expect(pairDirections([inverse, forward])).toEqual([{ claim: forward, partnerId: '1' }])
  })

  it('collapses a symmetric pair to the lower id', () => {
    const a = rel('b', 'sera', 'married_to', 'orin', 'married_to')
    const b = rel('a', 'orin', 'married_to', 'sera', 'married_to')
    expect(pairDirections([a, b])).toEqual([{ claim: b, partnerId: 'b' }])
  })

  it('pairs only claims with the same dates', () => {
    const forward = rel('1', 'sera', 'rules', 'ashfall', 'ruled_by', { startTime: 'AD 400' })
    const inverse = rel('2', 'ashfall', 'ruled_by', 'sera', 'rules', { startTime: 'AD 500' })
    expect(pairDirections([forward, inverse])).toHaveLength(2)
  })

  it('leaves an attribute, or a claim whose inverse is not present, on its own', () => {
    const attr: PairableClaim = { id: '1', subjectId: 'sera', objectId: null, predicate: 'title', inverseName: null, startTime: null, endTime: null }
    const lone = rel('2', 'ashfall', 'ruled_by', 'sera', 'rules')
    expect(pairDirections([attr, lone])).toEqual([
      { claim: attr, partnerId: null },
      { claim: lone, partnerId: null },
    ])
  })
})

describe('findMirrors', () => {
  const rel = (id: string, subjectId: string, predicate: string, objectId: string, inverseName: string | null, over: Partial<PairableClaim> = {}): PairableClaim => ({
    id, subjectId, objectId, predicate, inverseName, startTime: null, endTime: null, ...over,
  })

  it('finds the reverse direction of each contested claim', () => {
    const sera = rel('1', 'ashfall', 'ruled_by', 'sera', 'rules')
    const orin = rel('2', 'ashfall', 'ruled_by', 'orin', 'rules')
    const pool = [
      rel('3', 'sera', 'rules', 'ashfall', null),
      rel('4', 'orin', 'rules', 'ashfall', null),
      // Same ends, unrelated verb: not a mirror.
      rel('5', 'sera', 'born_in', 'ashfall', null),
    ]
    expect(findMirrors([sera, orin], pool)).toEqual(new Map([['1', '3'], ['2', '4']]))
  })

  it('matches dates, so a differently dated claim on the same ends is not the mirror', () => {
    const dated = rel('1', 'ashfall', 'ruled_by', 'sera', 'rules', { startTime: 'AD 400' })
    const pool = [
      rel('2', 'sera', 'rules', 'ashfall', null, { startTime: 'AD 500' }),
      rel('3', 'sera', 'rules', 'ashfall', null, { startTime: 'AD 400' }),
    ]
    expect(findMirrors([dated], pool)).toEqual(new Map([['1', '3']]))
  })

  it('skips attributes, predicates with no inverse, and claims already in the conflict', () => {
    const attr: PairableClaim = { id: '1', subjectId: 'sera', objectId: null, predicate: 'vital_status', inverseName: null, startTime: null, endTime: null }
    const noInverse = rel('2', 'ashfall', 'ruled_by', 'sera', null)
    // A symmetric pair already both on the sides: each is the other's mirror,
    // and both are marked anyway, so neither is reported twice.
    const a = rel('3', 'sera', 'married_to', 'orin', 'married_to')
    const b = rel('4', 'orin', 'married_to', 'sera', 'married_to')
    expect(findMirrors([attr, noInverse, a, b], [a, b])).toEqual(new Map())
  })
})
