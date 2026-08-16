# Nevlos Timekeeping

Reference for how in-world dates are written, parsed, and ordered. The implementation is
[`src/lib/ontology/calendar.ts`](../src/lib/ontology/calendar.ts); the schema side is in
[ontology-design.md](ontology-design.md).

This records the **reckoning Stone Brain sorts by**, not the whole of the world's timekeeping.
Nevlos has multiple calendar systems; the 11-month reckoning below is the cleanest and is the one
the ordinal scale is defined against. See *Other calendars* at the end.

## Eras

Time is counted from the Doom, in two eras:

| Era | Name | Direction |
| --- | --- | --- |
| **BD** | Before Doom | counts **backward** — BD 50 is earlier than BD 1 |
| **AD** | After Doom | counts forward |

**There is no year zero.** AD 1 begins on the first new year *after* the Doom began, so BD 1 is
the year immediately preceding AD 1 — and the Doom itself falls inside BD 1, partway through.

## The year

11 months, 365 days:

| Month | Days | Day-of-year of its first day |
| --- | --- | --- |
| 1–10 | 36 each | 1, 37, 73, 109, 145, 181, 217, 253, 289, 325 |
| 11 | 5 | 361 |

Months are referred to by number. Most records track **year and month**; day-level precision is
common only for events.

## The ordinal

Claims store a date twice: the verbatim label the source used (`start_time`), and a float sort
key (`start_order`). The label is authoritative; the ordinal exists only so claims can be ordered
and so Phase 3 can tell whether two validity windows overlap.

```
ordinal = yearBase + dayOfYearIndex / 365

yearBase        = AD:  year - 1        (AD 1 → 0)
                  BD:  -year           (BD 1 → -1)
dayOfYearIndex  = days elapsed in the year before this date (0-based)
```

So the scale is **years elapsed since the start of AD 1**, negative before it. A few anchors:

| Date | Ordinal |
| --- | --- |
| BD 50 | −50.0 |
| BD 1, month 11 (the last month before the Doom era) | −0.0137 |
| AD 1 | 0.0 |
| AD 412 | 411.0 |
| AD 412, month 4 | 411.2959 |
| AD 412, month 11, day 5 | 411.9973 |

Three properties this buys:

- **BD sorts correctly without special-casing.** Larger BD year → smaller ordinal.
- **Partial dates order against precise ones.** A year-only date resolves to the *start* of that
  year, so "AD 412" sorts before "month 4, AD 412". Worth knowing when reading a timeline: an
  imprecise date sits at the earliest point it could mean.
- **The gap across the era boundary is exactly right** — BD 1 runs from −1.0 up to (not quite)
  0.0, and AD 1 starts at 0.0. No off-by-one, no phantom year zero.

## Labels the parser accepts

Era and year are required; month and day are optional. Case, punctuation, and word order are all
flexible.

```
AD 412                    412 AD             A.D. 412
BD 50                     50 BD
month 4, AD 412           4th month of AD 412        fourth month, 412 AD
day 12, month 4, AD 412   AD 412-04-12               AD 412-04
```

A label that cannot be parsed is **still stored**, with a null ordinal. It is unordered, not
lost — the same rule ADR §7a applies to vanished source documents. Nothing about a claim depends
on its date being machine-readable.

Word order is free — `"AD 412, month 11, day 5"`, `"5th day, 11th month, AD 412"` and
`"month 11, day 5, AD 412"` all read the same. This is the part most likely to break under
editing, because a mis-bound number produces an entirely plausible wrong date rather than an
obvious failure; it is covered by tests in `calendar.test.ts`.

Two things are refused rather than guessed at:

- **Ranges.** `"AD 400–412"` parses to nothing. A claim spanning a period should use `start_time`
  and `end_time`, which is what they are for.
- **A day without a month.** `"day 12, AD 412"` is not a locatable date, so it reads as
  unparseable rather than silently dropping to the year.

## Why the ordinal is derived, never written

The extractor and the user supply only the label. The ordinal is computed from it.

An LLM asked for a sort key will produce a confident number, and there is no way to tell a wrong
one from a right one by looking at it. Calendar arithmetic belongs in one tested function.

## Other calendars

Because the ordinal is a plain float on a single scale, a second reckoning does not need new
columns or a second ordering — it needs a parser that lands on the same scale. If a source
document uses a regional calendar, the work is a conversion function into years-since-AD-1, and
everything downstream (sorting, overlap detection, the timeline view) keeps working unchanged.

Until such a parser exists, dates in another reckoning are stored as labels with null ordinals,
which is a degradation in ordering rather than a loss of information.
