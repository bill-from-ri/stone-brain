/**
 * In-world dates: parsing labels, and turning them into the float sort key that
 * `claims.start_order` / `end_order` / `value_order` hold.
 *
 * The rules are documented in docs/calendar.md. The short version: two eras
 * counted from the Doom (BD backward, AD forward, no year zero), 11 months of
 * 36 days except the last of 5, 365 days total.
 *
 * The label a source used is authoritative and always stored verbatim. The
 * ordinal is derived here and never supplied by a writer — an LLM asked for a
 * sort key produces a confident number no reviewer can check.
 */

export type Era = 'BD' | 'AD'

export type WorldDate = {
  era: Era
  /** 1-based. There is no year zero. */
  year: number
  /** 1–11 when known. */
  month?: number
  /** 1-based within the month, when known. */
  day?: number
}

export const MONTHS_PER_YEAR = 11
export const DAYS_PER_YEAR = 365
/** Months 1–10 have 36 days; the eleventh has 5. */
export const DAYS_IN_LONG_MONTH = 36
export const DAYS_IN_FINAL_MONTH = 5

export function daysInMonth(month: number): number {
  return month === MONTHS_PER_YEAR ? DAYS_IN_FINAL_MONTH : DAYS_IN_LONG_MONTH
}

/** Days elapsed in the year before `month` begins. Month 1 → 0. */
export function daysBeforeMonth(month: number): number {
  return (month - 1) * DAYS_IN_LONG_MONTH
}

export function isValidWorldDate(d: WorldDate): boolean {
  if (!Number.isInteger(d.year) || d.year < 1) return false
  if (d.month === undefined) return d.day === undefined
  if (!Number.isInteger(d.month) || d.month < 1 || d.month > MONTHS_PER_YEAR) return false
  if (d.day === undefined) return true
  return Number.isInteger(d.day) && d.day >= 1 && d.day <= daysInMonth(d.month)
}

/**
 * Years elapsed since the start of AD 1, negative before it.
 *
 * AD 1 → 0 and BD 1 → −1, which is what encodes "no year zero": BD 1 occupies
 * the interval [−1, 0) and AD 1 begins exactly at 0.
 *
 * An unknown month or day resolves to the start of the period, so an imprecise
 * date sorts at the earliest point it could mean.
 */
export function toOrdinal(date: WorldDate): number {
  const yearBase = date.era === 'AD' ? date.year - 1 : -date.year
  const dayIndex = date.month === undefined
    ? 0
    : daysBeforeMonth(date.month) + ((date.day ?? 1) - 1)
  return yearBase + dayIndex / DAYS_PER_YEAR
}

export function formatWorldDate(date: WorldDate): string {
  const year = `${date.era} ${date.year}`
  if (date.month === undefined) return year
  if (date.day === undefined) return `month ${date.month}, ${year}`
  return `day ${date.day}, month ${date.month}, ${year}`
}

/* --------------------------------------------------------------------- parsing */

const ORDINAL_WORDS = [
  'first', 'second', 'third', 'fourth', 'fifth', 'sixth',
  'seventh', 'eighth', 'ninth', 'tenth', 'eleventh',
]

/**
 * A range is two dates and belongs in start_time/end_time, so a label carrying
 * one is refused rather than silently read as its first half. Covers hyphen,
 * en dash, em dash and the word forms.
 */
const RANGE = /(\d\s*[–—]\s*\d)|\b(to|through|until|between)\b|\d\s+-\s+\d/

const COMPACT = /\b(\d{1,6})-(\d{1,2})(?:-(\d{1,2}))?\b/

function normalize(label: string): string {
  return label
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[,;]/g, ' ')
    // 4th -> 4, so ordinal suffixes never reach the digit/letter split below.
    .replace(/(\d)(?:st|nd|rd|th)\b/g, '$1')
    // ad412 -> ad 412; 412ad -> 412 ad. A word boundary does not fall between a
    // letter and a digit, so without this the era is invisible to \b.
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Binds each number in the label to exactly one unit.
 *
 * Regexes cannot do this reliably. "AD 412, month 11, day 5" and "5th day, 11th
 * month, AD 412" put the same three numbers in different places, and any
 * pattern that reads a number without claiming it will let a later pattern read
 * it again — "11 day" and "day 5" both match the first string, and only one of
 * them is the day. Every wrong answer here is a plausible-looking date, so the
 * scan claims each token as it consumes it and never reconsiders.
 *
 * The year is bound first, from whichever number sits next to the era, so that
 * `month` in "AD 412 month 11" cannot reach back across the era and swallow the
 * year. Units are then bound in reading order, each preferring the number on
 * its left — the combination is what gets "5 day", "day 5" and "day 12, month
 * 4" all right.
 */
function scan(text: string): { era: Era; year: number; month?: number; day?: number } | null {
  const tokens = text.split(' ').filter((t) => t && t !== 'of')
  const claimed = new Array<boolean>(tokens.length).fill(false)

  const numberAt = (i: number): number | null => {
    if (i < 0 || i >= tokens.length || claimed[i]) return null
    return /^\d{1,6}$/.test(tokens[i]!) ? Number(tokens[i]) : null
  }
  const claim = (i: number, value: number): number => {
    claimed[i] = true
    return value
  }

  const eraIndex = tokens.findIndex((t) => t === 'ad' || t === 'bd')
  if (eraIndex < 0) return null
  const era = tokens[eraIndex]!.toUpperCase() as Era
  claimed[eraIndex] = true

  const after = numberAt(eraIndex + 1)
  const before = numberAt(eraIndex - 1)
  if (after === null && before === null) return null
  const year = after !== null ? claim(eraIndex + 1, after) : claim(eraIndex - 1, before!)

  const bind = (i: number): number | undefined => {
    const left = numberAt(i - 1)
    if (left !== null) return claim(i - 1, left)

    const right = numberAt(i + 1)
    if (right !== null) return claim(i + 1, right)

    // "fourth month" — a written ordinal rather than a digit.
    const word = i > 0 && !claimed[i - 1] ? ORDINAL_WORDS.indexOf(tokens[i - 1]!) : -1
    return word >= 0 ? claim(i - 1, word + 1) : undefined
  }

  /**
   * Left to right, because a number sits between the two units in "day 12,
   * month 4" and belongs to whichever unit reaches it first in reading order.
   */
  const bound: Partial<Record<'month' | 'day', number>> = {}
  const units = (['month', 'day'] as const)
    .map((unit) => ({ unit, i: tokens.indexOf(unit) }))
    .filter(({ i }) => i >= 0)
    .sort((a, b) => a.i - b.i)

  for (const { unit, i } of units) {
    const value = bind(i)
    if (value !== undefined) bound[unit] = value
  }

  return { era, year, ...bound }
}

/**
 * Reads a written date. Era and year are required; month and day are optional.
 *
 * Deliberately returns null rather than guessing — an unparseable label is
 * stored with a null ordinal, which loses ordering but nothing else. Guessing
 * would put a wrong date into the graph looking exactly like a right one.
 */
export function parseWorldDate(label: string): WorldDate | null {
  const text = normalize(label)
  if (!text || RANGE.test(text)) return null
  if ((text.match(/\b(ad|bd)\b/g) ?? []).length !== 1) return null

  // AD 412-04-12 — the whole date sits in one token, so read it before tokenising.
  const compact = COMPACT.exec(text)
  if (compact) {
    const era = /\bbd\b/.test(text) ? 'BD' : 'AD'
    const date: WorldDate = {
      era,
      year: Number(compact[1]),
      month: Number(compact[2]),
      ...(compact[3] !== undefined && { day: Number(compact[3]) }),
    }
    return isValidWorldDate(date) ? date : null
  }

  const scanned = scan(text)
  if (!scanned) return null

  return isValidWorldDate(scanned) ? scanned : null
}

/**
 * Label → sort key, or null when it cannot be read. This is the single entry
 * point claim writing should use; nothing else should compute an ordinal.
 */
export function ordinalFor(label: string | null | undefined): number | null {
  if (!label) return null
  const date = parseWorldDate(label)
  return date ? toOrdinal(date) : null
}
