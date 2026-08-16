import { describe, expect, it } from 'vitest'
import {
  DAYS_PER_YEAR,
  MONTHS_PER_YEAR,
  centuryStartYear,
  daysBeforeMonth,
  daysInMonth,
  formatWorldDate,
  ordinalFor,
  parseWorldDate,
  toOrdinal,
} from './calendar'

describe('the year', () => {
  it('is 365 days across 11 months', () => {
    const total = Array.from({ length: MONTHS_PER_YEAR }, (_, i) => daysInMonth(i + 1))
      .reduce((a, b) => a + b, 0)
    expect(total).toBe(DAYS_PER_YEAR)
  })

  it('puts the short month last', () => {
    expect(daysInMonth(10)).toBe(36)
    expect(daysInMonth(11)).toBe(5)
    expect(daysBeforeMonth(1)).toBe(0)
    expect(daysBeforeMonth(11)).toBe(360)
  })
})

describe('ordinals', () => {
  it('places a century at its earliest year, in both directions', () => {
    // AD 3rd century covers AD 201–300; BD 3rd century covers BD 300–201, and
    // its earliest moment is the *larger* BD year.
    expect(toOrdinal({ era: 'AD', century: 3, year: centuryStartYear('AD', 3) })).toBe(200)
    expect(toOrdinal({ era: 'BD', century: 3, year: centuryStartYear('BD', 3) })).toBe(-300)
    expect(centuryStartYear('AD', 1)).toBe(1)
    expect(centuryStartYear('BD', 1)).toBe(100)
  })

  it('anchors AD 1 at zero and BD 1 immediately before it — there is no year zero', () => {
    expect(toOrdinal({ era: 'AD', year: 1 })).toBe(0)
    expect(toOrdinal({ era: 'BD', year: 1 })).toBe(-1)
  })

  it('leaves no gap across the era boundary', () => {
    const lastMomentBeforeDoom = toOrdinal({ era: 'BD', year: 1, month: 11, day: 5 })
    expect(lastMomentBeforeDoom).toBeLessThan(0)
    expect(lastMomentBeforeDoom).toBeGreaterThan(-1)
    // The final day of BD 1 is one day short of AD 1 beginning.
    expect(toOrdinal({ era: 'AD', year: 1 }) - lastMomentBeforeDoom).toBeCloseTo(1 / 365, 10)
  })

  it('counts BD backward', () => {
    expect(toOrdinal({ era: 'BD', year: 50 })).toBe(-50)
    expect(toOrdinal({ era: 'BD', year: 50 })).toBeLessThan(toOrdinal({ era: 'BD', year: 1 }))
  })

  it('resolves an imprecise date to the earliest point it could mean', () => {
    const yearOnly = toOrdinal({ era: 'AD', year: 412 })
    const withMonth = toOrdinal({ era: 'AD', year: 412, month: 4 })
    const withDay = toOrdinal({ era: 'AD', year: 412, month: 4, day: 12 })

    expect(yearOnly).toBe(411)
    expect(yearOnly).toBeLessThan(withMonth)
    expect(withMonth).toBeLessThan(withDay)
    expect(toOrdinal({ era: 'AD', year: 412, month: 1 })).toBe(yearOnly)
  })

  it('sorts a run of dates into chronological order', () => {
    const labels = [
      'AD 412, month 11, day 5',
      'BD 50',
      'AD 1',
      'month 4, AD 412',
      'BD 1, month 11',
      'AD 412',
      '3rd century',
    ]
    const sorted = [...labels].sort((a, b) => ordinalFor(a)! - ordinalFor(b)!)

    expect(sorted).toEqual([
      'BD 50',
      'BD 1, month 11',
      'AD 1',
      '3rd century',
      'AD 412',
      'month 4, AD 412',
      'AD 412, month 11, day 5',
    ])
  })
})

describe('parsing', () => {
  const cases: Array<[string, ReturnType<typeof parseWorldDate>]> = [
    ['AD 412', { era: 'AD', year: 412 }],
    ['412 AD', { era: 'AD', year: 412 }],
    ['A.D. 412', { era: 'AD', year: 412 }],
    ['ad412', { era: 'AD', year: 412 }],
    ['BD 50', { era: 'BD', year: 50 }],
    ['50 BD', { era: 'BD', year: 50 }],
    ['month 4, AD 412', { era: 'AD', year: 412, month: 4 }],
    ['4th month of AD 412', { era: 'AD', year: 412, month: 4 }],
    ['fourth month, 412 AD', { era: 'AD', year: 412, month: 4 }],
    ['eleventh month, BD 1', { era: 'BD', year: 1, month: 11 }],
    ['day 12, month 4, AD 412', { era: 'AD', year: 412, month: 4, day: 12 }],
    // The same three numbers in three orders. Each has to bind to the right
    // unit; a near-miss here is a wrong date that looks entirely plausible.
    ['AD 412, month 11, day 5', { era: 'AD', year: 412, month: 11, day: 5 }],
    ['5th day, 11th month, AD 412', { era: 'AD', year: 412, month: 11, day: 5 }],
    ['month 11, day 5, AD 412', { era: 'AD', year: 412, month: 11, day: 5 }],
    ['AD 412-04-12', { era: 'AD', year: 412, month: 4, day: 12 }],
    ['AD 412-04', { era: 'AD', year: 412, month: 4 }],
    // A bare year means AD: Nevlos is written almost entirely after the Doom,
    // so refusing this would reject the common case to guard the rare one.
    ['412', { era: 'AD', year: 412 }],
    ['month 4, 412', { era: 'AD', year: 412, month: 4 }],
    ['day 12, month 4, 412', { era: 'AD', year: 412, month: 4, day: 12 }],
    ['3rd century', { era: 'AD', century: 3, year: 201 }],
    ['third century AD', { era: 'AD', century: 3, year: 201 }],
    ['the 3rd century BD', { era: 'BD', century: 3, year: 300 }],
    ['century 3', { era: 'AD', century: 3, year: 201 }],
  ]

  for (const [label, expected] of cases) {
    it(`reads "${label}"`, () => {
      expect(parseWorldDate(label)).toEqual(expected)
    })
  }

  it('round-trips its own formatting', () => {
    for (const [, date] of cases) {
      expect(parseWorldDate(formatWorldDate(date!))).toEqual(date)
    }
  })
})

describe('parsing refuses rather than guessing', () => {
  const rejected = [
    ['', 'empty'],
    ['the winter after the Sundering', 'prose'],
    ['month 4 of the 3rd century', 'a month inside a century is not a date'],
    ['412 month 11 day 5', 'no era, and every number is claimed by a unit word'],
    ['sometime in the fourth month', 'no year or era'],
    ['AD 400 to AD 412', 'a range'],
    ['AD 400–412', 'a range with an en dash'],
    ['between BD 3 and AD 2', 'a range in words'],
    ['month 12, AD 412', 'only 11 months exist'],
    ['month 0, AD 412', 'months are 1-based'],
    ['day 36, month 11, AD 412', 'the eleventh month has 5 days'],
    ['day 37, month 1, AD 412', 'long months have 36 days'],
    ['AD 0', 'there is no year zero'],
    ['AD 412 BD', 'two eras'],
  ]

  for (const [label, why] of rejected) {
    it(`rejects "${label}" — ${why}`, () => {
      expect(parseWorldDate(label!)).toBeNull()
      expect(ordinalFor(label!)).toBeNull()
    })
  }

  it('treats a missing label as unordered rather than as an error', () => {
    expect(ordinalFor(null)).toBeNull()
    expect(ordinalFor(undefined)).toBeNull()
  })
})
