import { ordinalFor } from '@/lib/ontology/calendar'
import { normalizeLabel, windowOf } from './period'

/**
 * Whether two claims say the same thing — the other half of a value conflict.
 *
 * For a relationship that is plain identity of the object entity. For an
 * attribute it depends on the type, and dates are the case that needs care:
 * they are stored verbatim, so "AD 412", "412 AD" and "month 3, AD 412" are
 * three different strings and, read as dates, no disagreement at all. Two
 * date values agree when the stretches of calendar they name intersect — one
 * label is merely more precise than the other — and only when they cannot be
 * placed is the text compared instead.
 */

export type ValueColumns = {
  objectId: string | null
  valueString: string | null
  valueInt: number | null
  valueFloat: number | null
  valueTime: string | null
  valueOrder: number | null
}

export function sameValue(a: ValueColumns, b: ValueColumns): boolean {
  if (a.objectId !== null || b.objectId !== null) return a.objectId === b.objectId

  if (a.valueInt !== null || b.valueInt !== null) return a.valueInt === b.valueInt
  if (a.valueFloat !== null || b.valueFloat !== null) return a.valueFloat === b.valueFloat

  if (a.valueTime !== null || b.valueTime !== null) {
    if (a.valueTime === null || b.valueTime === null) return false
    const wa = windowOf({ label: a.valueTime, order: a.valueOrder ?? ordinalFor(a.valueTime) })
    const wb = windowOf({ label: b.valueTime, order: b.valueOrder ?? ordinalFor(b.valueTime) })
    // The equality covers a zero-width window (a bare sort key), which no
    // half-open interval can intersect.
    if (wa && wb) return wa.from === wb.from || (wa.from < wb.to && wb.from < wa.to)
    return normalizeLabel(a.valueTime) === normalizeLabel(b.valueTime)
  }

  // Enum members are machine names, but a hand-typed value may differ in case
  // or spacing; neither is a disagreement.
  return normalizeText(a.valueString) === normalizeText(b.valueString)
}

function normalizeText(value: string | null): string | null {
  return value === null ? null : value.trim().toLowerCase().replace(/\s+/g, ' ')
}
