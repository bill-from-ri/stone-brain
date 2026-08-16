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
  /**
   * 1-based. There is no year zero.
   *
   * When `century` is set this is the century's *earliest* year — AD 201 for
   * the 3rd century AD, BD 300 for the 3rd century BD — so ordering works with
   * no special case anywhere downstream.
   */
  year: number
  /** 1–11 when known. */
  month?: number
  /** 1-based within the month, when known. */
  day?: number
  /**
   * Set when the source gave only a century. `year` is derived from it, and
   * month and day cannot be present.
   */
  century?: number
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

/** The earliest year a century contains — which is the latest BD year in it. */
export function centuryStartYear(era: Era, century: number): number {
  return era === 'AD' ? (century - 1) * 100 + 1 : century * 100
}

export function isValidWorldDate(d: WorldDate): boolean {
  if (!Number.isInteger(d.year) || d.year < 1) return false
  if (d.century !== undefined) {
    if (!Number.isInteger(d.century) || d.century < 1) return false
    if (d.month !== undefined || d.day !== undefined) return false
    return d.year === centuryStartYear(d.era, d.century)
  }
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
  if (date.century !== undefined) return `${ordinalSuffix(date.century)} century ${date.era}`
  const year = `${date.era} ${date.year}`
  if (date.month === undefined) return year
  if (date.day === undefined) return `month ${date.month}, ${year}`
  return `day ${date.day}, month ${date.month}, ${year}`
}

function ordinalSuffix(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
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
const UNIT_WORDS = ['month', 'day', 'century'] as const

function scan(text: string): WorldDate | null {
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
  const isUnit = (i: number) =>
    i >= 0 && i < tokens.length && (UNIT_WORDS as readonly string[]).includes(tokens[i]!)

  /** Left, then right, then a written ordinal on the left ("fourth month"). */
  const bind = (i: number): number | undefined => {
    const left = numberAt(i - 1)
    if (left !== null) return claim(i - 1, left)

    const right = numberAt(i + 1)
    if (right !== null) return claim(i + 1, right)

    const word = i > 0 && !claimed[i - 1] ? ORDINAL_WORDS.indexOf(tokens[i - 1]!) : -1
    return word >= 0 ? claim(i - 1, word + 1) : undefined
  }

  /**
   * A missing era means AD.
   *
   * Nevlos is written almost entirely after the Doom, so refusing a bare `412`
   * would reject the common case to guard the rare one. The cost is that a
   * number in a date field is now always read as a date — which is what a date
   * field is for.
   */
  const eraIndex = tokens.findIndex((t) => t === 'ad' || t === 'bd')
  const era: Era = eraIndex >= 0 ? (tokens[eraIndex]!.toUpperCase() as Era) : 'AD'
  if (eraIndex >= 0) claimed[eraIndex] = true

  /**
   * A century *is* the year, so it is resolved before anything else and rules
   * out month and day — "month 4 of the 3rd century" is not a date.
   */
  const centuryIndex = tokens.indexOf('century')
  if (centuryIndex >= 0) {
    const century = bind(centuryIndex)
    if (century === undefined || century < 1) return null
    if (tokens.includes('month') || tokens.includes('day')) return null
    return { era, century, year: centuryStartYear(era, century) }
  }

  let year: number | undefined

  if (eraIndex >= 0) {
    /**
     * The year is whichever number sits against the era, and it is claimed
     * first so that `month` in "AD 412 month 11" cannot reach back across the
     * era marker and swallow it.
     */
    const after = numberAt(eraIndex + 1)
    const before = numberAt(eraIndex - 1)
    if (after === null && before === null) return null
    year = after !== null ? claim(eraIndex + 1, after) : claim(eraIndex - 1, before!)
  } else {
    /**
     * With no era there is no anchor, so the year is identified by exclusion:
     * the one number that no unit word is reaching for. "month 4, 412" gives
     * 412; "412 month 11 day 5" gives nothing, because every number there
     * touches a unit word and guessing would produce a plausible wrong date.
     */
    const free = tokens
      .map((_, i) => i)
      .filter((i) => numberAt(i) !== null && !isUnit(i - 1) && !isUnit(i + 1))
    if (free.length !== 1) return null
    year = claim(free[0]!, numberAt(free[0]!)!)
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
  // Two eras is a range or a typo; none is fine and means AD.
  if ((text.match(/\b(ad|bd)\b/g) ?? []).length > 1) return null

  // AD 412-04-12 — the whole date sits in one token, so read it before tokenising.
  const compact = COMPACT.exec(text)
  if (compact) {
    const era: Era = /\bbd\b/.test(text) ? 'BD' : 'AD'
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
