import { describe, expect, it } from 'vitest'
import { ordinalFor } from '@/lib/ontology/calendar'
import { periodOf, periodsConflict, sameBound, windowOf, type Period } from './period'

/** A period from labels, with sort keys computed the way writers compute them. */
function p(start?: string, end?: string): Period {
  return periodOf({
    startTime: start ?? null,
    startOrder: start ? ordinalFor(start) : null,
    endTime: end ?? null,
    endOrder: end ? ordinalFor(end) : null,
  })
}

const UNDATED = p()

/** Asserted both ways round: the gate must not depend on argument order. */
function conflicts(a: Period, b: Period, temporal = true): boolean {
  const forward = periodsConflict(a, b, temporal)
  expect(periodsConflict(b, a, temporal), 'symmetric').toBe(forward)
  return forward
}

describe('undated claims', () => {
  it('conflict when both are undated', () => {
    expect(conflicts(UNDATED, UNDATED)).toBe(true)
  })

  it('do not conflict when only one is dated — a succession with a date unrecorded', () => {
    expect(conflicts(UNDATED, p('AD 400', 'AD 412'))).toBe(false)
    expect(conflicts(UNDATED, p('AD 400'))).toBe(false)
    expect(conflicts(UNDATED, p(undefined, 'AD 412'))).toBe(false)
  })
})

describe('non-temporal predicates', () => {
  it('ignore dates entirely', () => {
    expect(conflicts(p('AD 400', 'AD 410'), p('AD 500', 'AD 510'), false)).toBe(true)
    expect(conflicts(UNDATED, p('AD 500'), false)).toBe(true)
    expect(conflicts(UNDATED, UNDATED, false)).toBe(true)
  })
})

describe('identical periods', () => {
  it('conflict', () => {
    expect(conflicts(p('AD 400', 'AD 412'), p('AD 400', 'AD 412'))).toBe(true)
  })

  it('match by date rather than by spelling', () => {
    expect(conflicts(p('AD 400', 'AD 412'), p('400 AD', 'ad412'))).toBe(true)
  })

  it('conflict when both give only the same start — two reigns beginning together', () => {
    expect(conflicts(p('AD 400'), p('AD 400'))).toBe(true)
  })

  it('conflict when both give only the same end', () => {
    expect(conflicts(p(undefined, 'AD 412'), p(undefined, 'AD 412'))).toBe(true)
  })

  it('match unplaceable labels by their words', () => {
    expect(conflicts(p('the Sundering'), p('The  Sundering.'))).toBe(true)
  })

  it('distinguish a year from the first day of that year, though they share a sort key', () => {
    const year = { label: 'AD 412', order: ordinalFor('AD 412') }
    const day = { label: 'day 1, month 1, AD 412', order: ordinalFor('day 1, month 1, AD 412') }
    expect(year.order).toBe(day.order)
    expect(sameBound(year, day)).toBe(false)
  })
})

describe('overlapping periods', () => {
  it('conflict when two reigns overlap', () => {
    expect(conflicts(p('AD 400', 'AD 420'), p('AD 410', 'AD 430'))).toBe(true)
  })

  it('conflict when one reign sits inside another', () => {
    expect(conflicts(p('AD 400', 'AD 420'), p('AD 405', 'AD 410'))).toBe(true)
  })

  it('conflict when a one-year reign falls inside another', () => {
    expect(conflicts(p('AD 400', 'AD 420'), p('AD 410', 'AD 410'))).toBe(true)
  })

  it('conflict when a reign begins in the middle of another', () => {
    expect(conflicts(p('AD 400', 'AD 420'), p('AD 410'))).toBe(true)
  })

  it('conflict when a reign ends in the middle of another', () => {
    expect(conflicts(p('AD 400', 'AD 420'), p(undefined, 'AD 410'))).toBe(true)
  })

  it('work across the era boundary', () => {
    expect(conflicts(p('BD 20', 'AD 10'), p('BD 5', 'AD 30'))).toBe(true)
  })
})

describe('successions', () => {
  it('do not conflict when one reign ends the year the next begins', () => {
    expect(conflicts(p('AD 400', 'AD 412'), p('AD 412', 'AD 430'))).toBe(false)
  })

  it('do not conflict when the periods are apart', () => {
    expect(conflicts(p('AD 400', 'AD 410'), p('AD 420', 'AD 430'))).toBe(false)
  })

  it('do not conflict when the next reign is dated only by its start, at the handover', () => {
    expect(conflicts(p('AD 400', 'AD 412'), p('AD 412'))).toBe(false)
  })

  it('do not conflict when the earlier reign is dated only by its end, at the handover', () => {
    expect(conflicts(p(undefined, 'AD 400'), p('AD 400', 'AD 412'))).toBe(false)
  })

  it('respect the coarser label at a handover rather than its first day', () => {
    // Ended mid-412, the next began "in 412": compatible, so not a conflict.
    expect(conflicts(p('AD 400', 'month 6, AD 412'), p('AD 412', 'AD 430'))).toBe(false)
  })

  it('do not conflict when a handover falls exactly at the turn of a year', () => {
    // A reigns into 411, B from 410: they meet at the instant 410 becomes 411
    // at the very least, and that is not proof of a shared moment.
    expect(conflicts(p('AD 400', 'AD 411'), p('AD 410', 'AD 420'))).toBe(false)
  })

  it('cannot be proven to overlap when each is dated by a start alone', () => {
    // "A from 400", "B from 412": the ordinary way prose records a succession.
    expect(conflicts(p('AD 400'), p('AD 412'))).toBe(false)
  })

  it('cannot be proven to overlap when one gives a start and the other an end', () => {
    expect(conflicts(p('AD 400'), p(undefined, 'AD 420'))).toBe(false)
  })
})

describe('unplaceable dates', () => {
  it('do not conflict when either period cannot be put on the timeline', () => {
    expect(conflicts(p('the Sundering'), p('AD 400', 'AD 420'))).toBe(false)
    expect(conflicts(p('AD 400', 'after the flood'), p('AD 405', 'AD 410'))).toBe(false)
  })

  it('do not conflict when two unplaceable labels differ', () => {
    expect(conflicts(p('the Sundering'), p('the Long Winter'))).toBe(false)
  })

  it('are re-read when stored without a sort key', () => {
    const stored = periodOf({ startTime: 'AD 400', startOrder: null, endTime: 'AD 420', endOrder: null })
    expect(stored.start?.order).toBe(ordinalFor('AD 400'))
    expect(conflicts(stored, p('AD 410'))).toBe(true)
  })
})

describe('windowOf', () => {
  it('spans a year, a month, a day and a century', () => {
    const width = (label: string) => {
      const w = windowOf({ label, order: ordinalFor(label) })!
      return w.to - w.from
    }
    expect(width('AD 412')).toBe(1)
    expect(width('month 3, AD 412')).toBeCloseTo(36 / 365)
    expect(width('month 11, AD 412')).toBeCloseTo(5 / 365)
    expect(width('day 4, month 3, AD 412')).toBeCloseTo(1 / 365)
    expect(width('3rd century AD')).toBe(100)
  })

  it('treats a sort key with no readable label as an instant', () => {
    expect(windowOf({ label: 'the Sundering', order: 7 })).toEqual({ from: 7, to: 7 })
  })

  it('cannot place a bound with no sort key', () => {
    expect(windowOf({ label: 'the Sundering', order: null })).toBeNull()
  })
})
