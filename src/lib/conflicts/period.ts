import {
  DAYS_PER_YEAR,
  daysInMonth,
  ordinalFor,
  parseWorldDate,
} from '@/lib/ontology/calendar'

/**
 * The time gate: whether two claims' validity windows let them disagree.
 *
 * A settlement with two rulers is a contradiction only if they ruled at once;
 * one after the other is a succession, and a succession is the commonest thing
 * the corpus says about rulers. So for a temporal predicate the question is
 * never "do these values differ" but "do these values differ *at the same
 * time*" — and the answer has to be read from dates that are verbatim labels,
 * often partial, sometimes unparseable, frequently missing on one side.
 *
 * Every rule below leans the same way: **a conflict is raised only when the
 * dates prove one**. A false conflict costs the user a dismissal, and an inbox
 * that cries wolf stops being read; a missed one is still sitting in the graph
 * for the next document to contradict more plainly.
 *
 * ## The rules, in the order they are applied
 *
 * 1. **Non-temporal predicate** — dates are ignored. `born_in` does not stop
 *    holding, so two birthplaces conflict whatever either claim is dated.
 * 2. **Both undated** — conflict. Nothing separates them, and two undated
 *    rulers of one city is exactly the contradiction worth seeing.
 * 3. **One dated, one undated** — *not* a conflict. Read as a succession with
 *    one reign's dates unrecorded, which is far likelier than a document
 *    asserting a co-ruler it never dates.
 * 4. **Identical periods** — conflict. Same start, same end, by sort key where
 *    both have one and by label otherwise, so "AD 412" and "412 AD" match.
 * 5. **Either period unplaceable** (a label the calendar cannot read, such as
 *    "the winter after the Sundering") — not a conflict. Different labels with
 *    no sort key cannot be compared, and guessing would be a false positive.
 * 6. **Provable overlap** — conflict; anything short of proof is not.
 *
 * ## What "provable" means with imprecise dates
 *
 * A label names a span, not an instant: "AD 412" is a whole year, and a reign
 * that "ended in 412" ended at some unknown moment inside it. Each claim
 * therefore has two intervals:
 *
 *   - **definitely holding** — from the *latest* moment its start label allows
 *     to the *earliest* moment its end label allows;
 *   - **possibly holding** — from the earliest start to the latest end.
 *
 * Two claims provably overlap if their definite intervals share some length,
 * or if one's possible interval lies wholly inside the other's definite one
 * (it held at *some* moment, and every candidate moment is one where the other
 * definitely held). A claim dated by one bound only — "from AD 405" — has no
 * definite interval at all: it holds at an unknown moment inside that label.
 *
 * This is what makes a handover read as a handover. "Ruled AD 400 – AD 412"
 * and "ruled from AD 412" touch at 412 without overlapping, and so do "until
 * month 6, AD 412" and "from AD 412" — the precision of the coarser label is
 * respected rather than truncated to its first day.
 */

/** One end of a validity window: the label as written, and its sort key if any. */
export type Bound = { label: string; order: number | null }

/** A claim's validity window. A missing bound is unknown — not open-ended. */
export type Period = { start: Bound | null; end: Bound | null }

export type PeriodColumns = {
  startTime: string | null
  startOrder: number | null
  endTime: string | null
  endOrder: number | null
}

/**
 * The period a claim row carries.
 *
 * The stored sort key is preferred; a label stored without one is re-read,
 * because a row written before the calendar understood its label should not
 * stay unplaceable forever. Only `ordinalFor` computes an ordinal — the same
 * rule calendar.ts sets for writers.
 */
export function periodOf(row: PeriodColumns): Period {
  return {
    start: boundOf(row.startTime, row.startOrder),
    end: boundOf(row.endTime, row.endOrder),
  }
}

function boundOf(label: string | null, order: number | null): Bound | null {
  const text = label?.trim()
  if (!text) return null
  return { label: text, order: order ?? ordinalFor(text) }
}

export function isDated(period: Period): boolean {
  return period.start !== null || period.end !== null
}

/**
 * Whether two claims' windows let a difference in value be a contradiction.
 * See the module comment for the rules and why each one leans the way it does.
 */
export function periodsConflict(a: Period, b: Period, temporal: boolean): boolean {
  if (!temporal) return true

  const aDated = isDated(a)
  const bDated = isDated(b)
  if (!aDated && !bDated) return true
  if (aDated !== bDated) return false

  if (sameBound(a.start, b.start) && sameBound(a.end, b.end)) return true

  const spanA = spanOf(a)
  const spanB = spanOf(b)
  if (!spanA || !spanB) return false

  return provablyOverlap(spanA, spanB)
}

/**
 * Two bounds name the same date: the same stretch of the calendar where both
 * can be placed, or failing that, the same words.
 *
 * The stretch, not just the sort key — "AD 412" and "day 1, month 1, AD 412"
 * share an ordinal, since an imprecise date sorts at its earliest moment, but
 * one is a year and the other a day, and they are not the same date.
 */
export function sameBound(a: Bound | null, b: Bound | null): boolean {
  if (a === null || b === null) return a === b
  const wa = windowOf(a)
  const wb = windowOf(b)
  if (wa && wb) return wa.from === wb.from && wa.to === wb.to
  return normalizeLabel(a.label) === normalizeLabel(b.label)
}

export function normalizeLabel(label: string): string {
  return label.toLowerCase().replace(/[.,;]/g, ' ').replace(/\s+/g, ' ').trim()
}

/* ----------------------------------------------------------- the arithmetic */

/** A label as an interval of world time: `[from, to)` in ordinal years. */
export type Window = { from: number; to: number }

/**
 * The stretch of time a date label covers, or null if it cannot be placed.
 *
 * A year is one unit wide, a month 36 days (the eleventh, 5), a day one, a
 * century a hundred. A sort key with no parseable label behind it — something
 * a writer supplied directly — is treated as an exact instant, which is the
 * strictest reading available and so the conservative one.
 */
export function windowOf(bound: Bound): Window | null {
  if (bound.order === null) return null
  const date = parseWorldDate(bound.label)
  let width = 0
  if (date) {
    if (date.century !== undefined) width = 100
    else if (date.month === undefined) width = 1
    else if (date.day === undefined) width = daysInMonth(date.month) / DAYS_PER_YEAR
    else width = 1 / DAYS_PER_YEAR
  }
  return { from: bound.order, to: bound.order + width }
}

type Span = {
  /** Where the claim certainly held. Null for a single-bound claim, or one too short to be sure of. */
  definite: Window | null
  /** Every moment at which it could have held. */
  possible: Window
}

/** Null when a bound that is present cannot be placed on the timeline. */
function spanOf(period: Period): Span | null {
  const start = period.start ? windowOf(period.start) : undefined
  const end = period.end ? windowOf(period.end) : undefined
  if (start === null || end === null) return null

  if (start && end) {
    const definite = { from: start.to, to: end.from }
    return {
      definite: definite.from < definite.to ? definite : null,
      possible: { from: start.from, to: end.to },
    }
  }

  // One bound: the claim held at some moment inside that label, no more.
  const only = (start ?? end)!
  return { definite: null, possible: only }
}

function provablyOverlap(a: Span, b: Span): boolean {
  if (a.definite && b.definite) {
    const from = Math.max(a.definite.from, b.definite.from)
    const to = Math.min(a.definite.to, b.definite.to)
    if (from < to) return true
  }
  return within(a.possible, b.definite) || within(b.possible, a.definite)
}

function within(inner: Window, outer: Window | null): boolean {
  return outer !== null && inner.from >= outer.from && inner.to <= outer.to
}
