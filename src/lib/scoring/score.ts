/**
 * Extraction scoring: one model's claims for a document, against the claims a
 * person read out of the same document by hand (implementation plan §4b).
 *
 * The aim is proportionate — to tell whether a model is extracting tolerably
 * on the seeded documents, not to rank models to the second decimal place. So
 * the rule is strict and simple, and the report says *why* each claim failed
 * rather than only how many did.
 *
 * ## What counts as a match
 *
 * A **fact** matches when subject, predicate, and object (relationship) or
 * value (attribute) all agree:
 *
 *   - Entities compare on `looseNameKey` — the matcher's own key, so case,
 *     diacritics, punctuation and a leading article do not matter — against
 *     the seed entity's name *and its variants*, and the entity type must
 *     agree. "Akali Archipelago" is Akál; a Kaldian Empire typed as a faction
 *     is not the society the seed names.
 *   - Relationships compare in **one canonical direction**: the one the
 *     registry declares (`rules`, not `ruled_by`). "Syrath created the
 *     Shroud" and "the Shroud was created by Syrath" are one fact; a symmetric
 *     predicate matches with its ends either way round. This is also what
 *     keeps the score stable once §5 materialises every inverse claim.
 *   - Values compare by what they mean: numbers numerically, dates by their
 *     calendar ordinal where the label parses, text on `normalizeName`.
 *
 * A **claim** matches when its fact matches *and* its quote is verbatim in the
 * document *and* that quote overlaps the ground truth's (see ./quotes.ts). A
 * right fact with a bad citation is reported as such — paraphrased, or verbatim
 * but citing another passage — instead of being folded in with wrong facts.
 *
 * Start and end times are compared on every right fact but are not part of the
 * match: whether the model dated a claim is a separate question from whether
 * it found it, and the seeds date very few.
 *
 * ## Duplicates
 *
 * The claims table collapses a repeated fact onto one row (its fingerprint),
 * so two extracted claims for one fact are scored as one: the best-cited copy
 * is kept, the rest are marked `duplicate` and left out of precision.
 *
 * Pure: no database, no network. The script in scripts/score-extraction.ts does
 * the file reading and the printing.
 */

import type { ValueType } from '@/db/schema'
import { ordinalFor } from '@/lib/ontology/calendar'
import type { ExtractedClaim } from '@/lib/ontology/extraction'
import { looseNameKey, normalizeName } from '@/lib/ontology/name-key'
import { RELATIONSHIPS, deriveOntology, type PredicateRow } from '@/lib/ontology/registry'
import type { SeedClaim, SeedEntity, SourcedSeedClaim } from '@/lib/ontology/seed-world'
import { type QuoteSpan, type QuotedParagraph, locateQuote, spansOverlap } from './quotes'

/* ---------------------------------------------------------------- directions */

/** How one predicate is compared: under which name, and which way round. */
export type Direction = {
  /** The predicate every claim using this one is compared as. */
  canonical: string
  /** Subject and object swap when rewriting into the canonical direction. */
  flipped: boolean
  symmetric: boolean
  /** Attributes only: which value column the predicate routes into. */
  valueType: ValueType | null
}

/**
 * Canonical directions for a set of predicate rows.
 *
 * `declared` names the direction to keep for each inverse pair. Without it the
 * choice would have to be arbitrary (alphabetical makes `contains` canonical
 * over `located_in`), and the per-predicate report would read backwards to
 * anyone who wrote the seeds.
 */
export function predicateDirections(
  predicates: readonly PredicateRow[],
  declared: ReadonlySet<string>,
): Map<string, Direction> {
  const directions = new Map<string, Direction>()
  for (const p of predicates) {
    const keepsName = p.kind === 'attribute' || p.isSymmetric || p.inverseName === null || declared.has(p.name)
    directions.set(p.name, {
      canonical: keepsName ? p.name : p.inverseName!,
      flipped: !keepsName,
      symmetric: p.isSymmetric,
      valueType: p.valueType,
    })
  }
  return directions
}

/** The core vocabulary's directions: each pair compared as `RELATIONSHIPS` declares it. */
export function coreDirections(): Map<string, Direction> {
  return predicateDirections(deriveOntology().predicates, new Set(RELATIONSHIPS.map((r) => r.name)))
}

/* ------------------------------------------------------------------ entities */

/**
 * Which seed entities a name can mean.
 *
 * Built over *every* seed's entities rather than one document's, because that
 * is the world the matcher sees: Runara's variant "Frost Gulf" is declared in
 * Written Map's entity list but is just as much its name in *The Runar*. An
 * entity is identified by type and normalised canonical name, the same key the
 * entities table is unique on.
 */
class EntityIndex {
  private byKey = new Map<string, Set<string>>()
  private typeByName = new Map<string, string>()

  constructor(entities: readonly SeedEntity[]) {
    for (const e of entities) {
      this.typeByName.set(e.name, e.type)
      for (const name of [e.name, ...(e.variants ?? [])]) {
        const key = `${e.type}|${looseNameKey(name)}`
        if (!this.byKey.has(key)) this.byKey.set(key, new Set())
        this.byKey.get(key)!.add(entityId(e.type, e.name))
      }
    }
  }

  /** The id of an entity a seed claim names by its canonical name. */
  seedId(name: string): string {
    const type = this.typeByName.get(name)
    if (type === undefined) throw new Error(`Seed claim names an entity no seed lists: ${name}`)
    return entityId(type, name)
  }

  /**
   * Every seed entity an extracted name could be. A name no seed knows is
   * still given an id of its own, so two extracted claims about the same
   * unknown entity are recognised as duplicates of each other.
   */
  resolve(name: string, type: string): string[] {
    const known = this.byKey.get(`${type}|${looseNameKey(name)}`)
    return known ? [...known].sort() : [`${type}|?${looseNameKey(name)}`]
  }

  /** As `resolve`, ignoring the type the model gave — for diagnosing near misses only. */
  resolveAnyType(name: string): string[] {
    const key = looseNameKey(name)
    return [...this.byKey.entries()].filter(([k]) => k.slice(k.indexOf('|') + 1) === key).flatMap(([, ids]) => [...ids])
  }
}

const entityId = (type: string, name: string) => `${type}|${normalizeName(name)}`

/* --------------------------------------------------------------------- facts */

/** A claim reduced to what decides whether two claims say the same thing. */
type Fact = {
  predicate: string
  symmetric: boolean
  subject: string[]
  object?: string[]
  value?: string
}

const asNumberKey = (n: number) => `n:${n}`

/** Dates by ordinal when the label parses, so "918" and "918 AD" agree; otherwise by label. */
function dateKey(label: string): string {
  const order = ordinalFor(label)
  return order === null ? `t:${normalizeName(label)}` : `d:${order}`
}

function seedValueKey(value: string | number, valueType: ValueType | null): string {
  if (valueType === 'int' || valueType === 'float') return asNumberKey(Number(value))
  if (valueType === 'date') return dateKey(String(value))
  return `s:${normalizeName(String(value))}`
}

function extractedValueKey(c: ExtractedClaim): string | undefined {
  if (c.valueInt !== undefined) return asNumberKey(c.valueInt)
  if (c.valueFloat !== undefined) return asNumberKey(c.valueFloat)
  if (c.valueTime !== undefined) return dateKey(c.valueTime)
  if (c.valueString !== undefined) return `s:${normalizeName(c.valueString)}`
  return undefined
}

function directionOf(directions: Map<string, Direction>, predicate: string): Direction {
  // A predicate outside the map (a user's edited vocabulary) is compared as itself.
  return directions.get(predicate) ?? { canonical: predicate, flipped: false, symmetric: false, valueType: null }
}

function factMatches(truth: Fact, extracted: Fact): boolean {
  if (truth.predicate !== extracted.predicate) return false
  // The truth side always holds exactly one id; the extracted side may hold
  // several, when a name is shared (Runara's variant "Frost Gulf").
  const has = (ids: string[] | undefined, id: string[] | undefined) => !!ids && !!id && ids.includes(id[0]!)
  if (truth.value !== undefined) return has(extracted.subject, truth.subject) && truth.value === extracted.value
  if (has(extracted.subject, truth.subject) && has(extracted.object, truth.object)) return true
  return truth.symmetric && has(extracted.object, truth.subject) && has(extracted.subject, truth.object)
}

/** A string identifying the fact, so repeated extractions of it can be grouped. */
function factKey(f: Fact): string {
  const subject = f.subject.join('/')
  if (f.value !== undefined) return `${f.predicate}|${subject}|=${f.value}`
  const ends = [subject, f.object!.join('/')]
  if (f.symmetric) ends.sort()
  return `${f.predicate}|${ends.join('|')}`
}

function timeKey(label: string | undefined): string | undefined {
  return label === undefined ? undefined : dateKey(label)
}

/* ------------------------------------------------------------------- results */

/**
 * How well one claim was found, best first.
 *
 *   matched            fact right, quote verbatim and overlapping the ground truth's
 *   quote_elsewhere    fact right, quote verbatim, but citing a different passage
 *   quote_paraphrased  fact right, quote not in the document
 */
export type Grade = 'matched' | 'quote_elsewhere' | 'quote_paraphrased'

export type TruthResult = {
  claim: SourcedSeedClaim
  /** The canonical predicate it is counted under. */
  predicate: string
  outcome: Grade | 'missed'
  /** Index into the extracted claims of the copy it was paired with. */
  extracted?: number
  /** Only for a right fact: whether start and end times agree. */
  timesAgree?: boolean
  /** Only for a miss: an extracted claim that says it but types an entity differently. */
  nearMiss?: { extracted: number; reason: string }
}

export type ExtractedResult = {
  claim: ExtractedClaim
  predicate: string
  /** The quote occurs in the document, modulo whitespace and quote marks. */
  verbatim: boolean
  /**
   * `unmatched` is not necessarily wrong: the ground truth labels what one
   * person read, and a model can find a fact they did not label.
   */
  outcome: Grade | 'unmatched' | 'duplicate'
  /** Index into the truth results it was paired with. */
  truth?: number
  /** For a duplicate: index of the extracted copy that was scored. */
  duplicateOf?: number
}

export type Tally = {
  /** Ground-truth claims. */
  truth: number
  /** Distinct facts extracted — duplicates excluded. */
  extracted: number
  /** Claims matched in full: fact and citation. */
  matched: number
  /** Facts right, whatever their citation. */
  factMatched: number
}

export type TimeTally = {
  /** Right facts whose times were compared. */
  compared: number
  agree: number
  /** Of `compared`, those where either side carried a start or end time. */
  dated: number
  datedAgree: number
}

export type DocumentScore = {
  truth: TruthResult[]
  extracted: ExtractedResult[]
  total: Tally
  byPredicate: Record<string, Tally>
  times: TimeTally
}

export type ScoreInput = {
  paragraphs: readonly QuotedParagraph[]
  extracted: readonly ExtractedClaim[]
  /** This document's seed claims; hand-entered ones are dropped, as they cite no document. */
  truth: readonly SeedClaim[]
  /** Every seed's entities, for resolving names and variants. */
  entities: readonly SeedEntity[]
  directions?: Map<string, Direction>
}

const RANK: Record<Grade, number> = { matched: 3, quote_elsewhere: 2, quote_paraphrased: 1 }
const GRADES: Grade[] = ['matched', 'quote_elsewhere', 'quote_paraphrased']

/* --------------------------------------------------------------------- score */

export function scoreDocument(input: ScoreInput): DocumentScore {
  const directions = input.directions ?? coreDirections()
  const index = new EntityIndex(input.entities)

  const truthClaims = input.truth.filter((c): c is SourcedSeedClaim => c.handEntered === undefined)
  const truthFacts = truthClaims.map((c): Fact => {
    const d = directionOf(directions, c.predicate)
    const subject = [index.seedId(c.subject)]
    if (c.value !== undefined) {
      return { predicate: d.canonical, symmetric: false, subject, value: seedValueKey(c.value, d.valueType) }
    }
    const object = [index.seedId(c.object!)]
    return d.flipped
      ? { predicate: d.canonical, symmetric: d.symmetric, subject: object, object: subject }
      : { predicate: d.canonical, symmetric: d.symmetric, subject, object }
  })
  // A seed quote is checked against the document by scripts/check-seed-quotes.ts,
  // so it is located in the paragraph it cites; anywhere else is a fallback.
  const truthSpans = truthClaims.map((c) => {
    const cited = locateQuote(c.quote, input.paragraphs.filter((p) => p.index === c.paragraph))
    return cited.length > 0 ? cited : locateQuote(c.quote, input.paragraphs)
  })

  const toFact = (c: ExtractedClaim, resolve: (name: string, type: string) => string[]): Fact => {
    const d = directionOf(directions, c.predicate)
    const subject = resolve(c.subjectName, c.subjectType)
    if (c.objectName === undefined) {
      return { predicate: d.canonical, symmetric: false, subject, value: extractedValueKey(c) }
    }
    const object = resolve(c.objectName, c.objectType!)
    return d.flipped
      ? { predicate: d.canonical, symmetric: d.symmetric, subject: object, object: subject }
      : { predicate: d.canonical, symmetric: d.symmetric, subject, object }
  }
  const extractedFacts = input.extracted.map((c) => toFact(c, (n, t) => index.resolve(n, t)))
  const extractedSpans = input.extracted.map((c) => locateQuote(c.quote, input.paragraphs))

  // One group per distinct fact, in order of first appearance.
  const groups = new Map<string, number[]>()
  extractedFacts.forEach((f, i) => {
    const key = factKey(f)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(i)
  })
  const groupList = [...groups.values()]

  const gradeOf = (member: number, truth: number): Grade => {
    const spans: QuoteSpan[] = extractedSpans[member]!
    if (spans.length === 0) return 'quote_paraphrased'
    return spansOverlap(spans, truthSpans[truth]!) ? 'matched' : 'quote_elsewhere'
  }

  // Pair one group with one truth claim, best grade first, so a well-cited copy
  // of a fact is never spent on a truth claim it only half-matches while a
  // better pairing goes begging.
  const pairing = new Map<number, { group: number; member: number; grade: Grade }>()
  const groupTaken = new Set<number>()
  for (const grade of GRADES) {
    truthFacts.forEach((fact, t) => {
      if (pairing.has(t)) return
      for (const [g, members] of groupList.entries()) {
        if (groupTaken.has(g) || !factMatches(fact, extractedFacts[members[0]!]!)) continue
        const member = members.find((m) => gradeOf(m, t) === grade)
        if (member === undefined) continue
        pairing.set(t, { group: g, member, grade })
        groupTaken.add(g)
        return
      }
    })
  }

  const extracted: ExtractedResult[] = input.extracted.map((claim, i) => ({
    claim,
    predicate: extractedFacts[i]!.predicate,
    verbatim: extractedSpans[i]!.length > 0,
    outcome: 'unmatched',
  }))
  const truthByGroup = new Map([...pairing].map(([t, p]) => [p.group, { t, ...p }]))
  groupList.forEach((members, g) => {
    const paired = truthByGroup.get(g)
    const kept = paired?.member ?? members[0]!
    for (const m of members) {
      if (m !== kept) Object.assign(extracted[m]!, { outcome: 'duplicate', duplicateOf: kept })
    }
    if (paired) Object.assign(extracted[kept]!, { outcome: paired.grade, truth: paired.t })
  })

  const truth: TruthResult[] = truthClaims.map((claim, t) => {
    const predicate = truthFacts[t]!.predicate
    const paired = pairing.get(t)
    if (paired) {
      const other = input.extracted[paired.member]!
      const timesAgree =
        timeKey(claim.startTime) === timeKey(other.startTime) && timeKey(claim.endTime) === timeKey(other.endTime)
      return { claim, predicate, outcome: paired.grade, extracted: paired.member, timesAgree }
    }
    const result: TruthResult = { claim, predicate, outcome: 'missed' }
    const near = input.extracted.findIndex((c) =>
      factMatches(truthFacts[t]!, toFact(c, (n) => index.resolveAnyType(n))),
    )
    if (near !== -1) result.nearMiss = { extracted: near, reason: typeDifference(claim, input.extracted[near]!, index) }
    return result
  })

  return { truth, extracted, ...tallies(truth, extracted) }
}

/** Says which entity the model typed differently, for a near miss. */
function typeDifference(truth: SourcedSeedClaim, extracted: ExtractedClaim, index: EntityIndex): string {
  const typeOf = (name: string) => index.seedId(name).split('|')[0]!
  const typed = [
    { name: truth.subject, want: typeOf(truth.subject) },
    ...(truth.object !== undefined ? [{ name: truth.object, want: typeOf(truth.object) }] : []),
  ]
  const given = [extracted.subjectType, extracted.objectType].filter((t): t is string => t !== undefined)
  const wrong = typed.filter((e) => !given.includes(e.want))
  const got = given.filter((g) => !typed.some((e) => e.want === g))
  return wrong.length > 0
    ? `${wrong.map((e) => `${e.name} is a ${e.want}`).join('; ')} — extracted as ${got.join(', ') || 'another type'}`
    : 'the same fact, already paired with another ground-truth claim'
}

function tallies(truth: TruthResult[], extracted: ExtractedResult[]) {
  const total = emptyTally()
  const byPredicate: Record<string, Tally> = {}
  const bucket = (predicate: string) => (byPredicate[predicate] ??= emptyTally())

  for (const t of truth) {
    for (const tally of [total, bucket(t.predicate)]) {
      tally.truth++
      if (t.outcome === 'matched') tally.matched++
      if (t.outcome !== 'missed') tally.factMatched++
    }
  }
  for (const e of extracted) {
    if (e.outcome === 'duplicate') continue
    total.extracted++
    bucket(e.predicate).extracted++
  }

  const times = emptyTimes()
  for (const t of truth) {
    if (t.timesAgree === undefined) continue
    const dated = [t.claim.startTime, t.claim.endTime].some((x) => x !== undefined) ||
      (t.extracted !== undefined && [extracted[t.extracted]!.claim.startTime, extracted[t.extracted]!.claim.endTime].some((x) => x !== undefined))
    times.compared++
    if (t.timesAgree) times.agree++
    if (dated) {
      times.dated++
      if (t.timesAgree) times.datedAgree++
    }
  }
  return { total, byPredicate, times }
}

const emptyTally = (): Tally => ({ truth: 0, extracted: 0, matched: 0, factMatched: 0 })
const emptyTimes = (): TimeTally => ({ compared: 0, agree: 0, dated: 0, datedAgree: 0 })

/* --------------------------------------------------------------- aggregation */

/** Several documents' scores summed — the run as a whole. */
export function combineScores(scores: readonly DocumentScore[]): Pick<DocumentScore, 'total' | 'byPredicate' | 'times'> {
  const total = emptyTally()
  const byPredicate: Record<string, Tally> = {}
  const times = emptyTimes()
  const add = <T extends Record<string, number>>(into: T, from: T) => {
    for (const k of Object.keys(from) as (keyof T & string)[]) (into as Record<string, number>)[k]! += from[k]!
  }
  for (const s of scores) {
    add(total, s.total)
    add(times, s.times)
    for (const [p, tally] of Object.entries(s.byPredicate)) add((byPredicate[p] ??= emptyTally()), tally)
  }
  return { total, byPredicate, times }
}

export type Rates = {
  precision: number | null
  recall: number | null
  f1: number | null
  /** As precision and recall, counting a right fact whatever its citation. */
  factPrecision: number | null
  factRecall: number | null
}

/** Null where the denominator is zero: "no claims to recall" is not a recall of 0 or 1. */
export function rates(t: Tally): Rates {
  const ratio = (n: number, d: number) => (d === 0 ? null : n / d)
  const precision = ratio(t.matched, t.extracted)
  const recall = ratio(t.matched, t.truth)
  const f1 =
    precision === null || recall === null ? null : precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
  return { precision, recall, f1, factPrecision: ratio(t.factMatched, t.extracted), factRecall: ratio(t.factMatched, t.truth) }
}
