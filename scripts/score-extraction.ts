/**
 * `npm run extract:score -- <run-label> [--json]` — score a captured extraction
 * run against the hand-seeded ground truth (implementation plan §4b).
 *
 * Reads `corpus/scoring/captures/<run-label>/<seed>.json`, written by
 * `npm run extract:capture`, and prints precision, recall and F1 per document
 * and per predicate, then every ground-truth claim that was missed and every
 * extracted claim that matched nothing. The match rule is in
 * src/lib/scoring/score.ts and docs/extraction-scoring.md.
 *
 *   --json   also write the full result to `corpus/scoring/results/<run-label>.json`
 *
 * Spends nothing: no model, no database, no Drive. The fixture carries the
 * paragraphs the model was shown, so quotes are checked against exactly the
 * text it saw, and a run can be re-scored as the rule changes.
 *
 * A seed whose capture failed (`<seed>.failed.json`) is scored as extracting
 * nothing — the document's ground truth was still not found.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ExtractedClaim } from '@/lib/ontology/extraction'
// The seed data is private and gitignored (see src/lib/ontology/ground-truth.ts).
import * as kaldia from '../corpus/seeds/kaldia'
import * as runar from '../corpus/seeds/runar'
import * as world from '../corpus/seeds/world'
import type { SeedClaim } from '@/lib/ontology/ground-truth'
import { MIN_SHARED_CHARS } from '@/lib/scoring/quotes'
import {
  type DocumentScore,
  type ExtractedResult,
  type Tally,
  type TruthResult,
  combineScores,
  rates,
  scoreDocument,
} from '@/lib/scoring/score'

/** Every hand-seeded document — the same list `check-seed-quotes.ts` and `capture-extraction.ts` keep. */
const SEEDS: Record<string, { name: string; claims: SeedClaim[] }> = {
  world: { name: world.SEED_DOCUMENT.name, claims: world.SEED_CLAIMS },
  kaldia: { name: kaldia.SEED_DOCUMENT_KALDIA.name, claims: kaldia.KALDIA_CLAIMS },
  runar: { name: runar.SEED_DOCUMENT_RUNAR.name, claims: runar.RUNAR_CLAIMS },
}
/** All seeds' entities: names and variants resolve across documents, as the matcher's do. */
const ENTITIES = [...world.SEED_ENTITIES, ...kaldia.KALDIA_ENTITIES, ...runar.RUNAR_ENTITIES]

type Fixture = {
  capturedAt: string
  modelRequested: string
  systemPromptSha: string
  driveVersion: number | null
  paragraphs: { index: number; text: string }[]
  run: { claims: ExtractedClaim[]; rejections: unknown[]; model: string; attempts: number; responseFormat: string | null }
}

const label = process.argv.slice(2).find((a) => !a.startsWith('--'))
const asJson = process.argv.includes('--json')
if (!label) {
  console.error('Usage: npm run extract:score -- <run-label> [--json]')
  process.exit(1)
}
const captureDir = join('corpus', 'scoring', 'captures', label)
if (!existsSync(captureDir)) {
  console.error(`No capture at ${captureDir} — run \`npm run extract:capture -- ${label}\` first.`)
  process.exit(1)
}

type Scored = { seed: string; fixture: Fixture | null; failure: string | null; score: DocumentScore }
const scored: Scored[] = []

for (const [seed, truth] of Object.entries(SEEDS)) {
  const path = join(captureDir, `${seed}.json`)
  const failedPath = join(captureDir, `${seed}.failed.json`)
  if (existsSync(path)) {
    const fixture = JSON.parse(readFileSync(path, 'utf8')) as Fixture
    const score = scoreDocument({ paragraphs: fixture.paragraphs, extracted: fixture.run.claims, truth: truth.claims, entities: ENTITIES })
    scored.push({ seed, fixture, failure: null, score })
  } else if (existsSync(failedPath)) {
    const failed = JSON.parse(readFileSync(failedPath, 'utf8')) as { code: string; message: string }
    const score = scoreDocument({ paragraphs: [], extracted: [], truth: truth.claims, entities: ENTITIES })
    scored.push({ seed, fixture: null, failure: `${failed.code}: ${failed.message}`, score })
  }
}
if (scored.length === 0) {
  console.error(`${captureDir} holds no fixtures for any known seed (${Object.keys(SEEDS).join(', ')}).`)
  process.exit(1)
}
const combined = combineScores(scored.map((s) => s.score))

/* ------------------------------------------------------------------ printing */

const pct = (r: number | null) => (r === null ? '   –' : `${Math.round(r * 100)}%`.padStart(4))
const row = (cells: (string | number)[], widths: number[]) =>
  cells.map((c, i) => (i === 0 ? String(c).padEnd(widths[i]!) : String(c).padStart(widths[i]!))).join('  ')

function tallyCells(t: Tally): (string | number)[] {
  const r = rates(t)
  return [t.truth, t.extracted, t.matched, pct(r.precision), pct(r.recall), pct(r.f1), t.factMatched, pct(r.factPrecision), pct(r.factRecall)]
}
const TALLY_HEAD = ['truth', 'extr', 'match', 'P', 'R', 'F1', 'facts', 'fP', 'fR']
const TALLY_W = [5, 4, 5, 4, 4, 4, 5, 4, 4]

/** A claim as it was stated, for a person to recognise. */
function stated(c: { subject: string; predicate: string; object?: string; value?: string | number }): string {
  return `${c.subject} ${c.predicate} ${c.object ?? JSON.stringify(c.value)}`
}
function statedExtracted(c: ExtractedClaim): string {
  const value = c.valueInt ?? c.valueFloat ?? c.valueTime ?? c.valueString
  const object = c.objectName !== undefined ? `${c.objectName} (${c.objectType})` : JSON.stringify(value)
  return `${c.subjectName} (${c.subjectType}) ${c.predicate} ${object}`
}
const clip = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

const out: string[] = []
const first = scored.find((s) => s.fixture)?.fixture
out.push(`run      : ${label}`)
if (first) {
  out.push(
    `model    : ${first.run.model} (asked for ${first.modelRequested}), ${first.run.attempts} attempt(s), ` +
      `format ${first.run.responseFormat ?? 'text'}, prompt ${first.systemPromptSha}, captured ${first.capturedAt}`,
  )
}
out.push(`rule     : fact = subject + canonical predicate + object/value, entity types must agree;`)
out.push(`           match = right fact + verbatim quote overlapping the ground truth's (≥ ${MIN_SHARED_CHARS} chars)`)
out.push('')

const docW = [28, ...TALLY_W]
out.push(row(['DOCUMENT', ...TALLY_HEAD], docW))
for (const s of scored) {
  const name = `${s.seed} — ${SEEDS[s.seed]!.name}`
  out.push(row([clip(name, 28), ...tallyCells(s.score.total)], docW) + (s.failure ? `   FAILED (${s.failure})` : ''))
}
out.push(row(['all', ...tallyCells(combined.total)], docW))
out.push('')
out.push('  P/R/F1 count full matches. facts/fP/fR count a right fact whatever its quote.')
out.push('  extr counts distinct facts: a fact extracted twice is scored once.')

const grades = scored.flatMap((s) => s.score.truth.map((t) => t.outcome))
const count = (o: TruthResult['outcome']) => grades.filter((g) => g === o).length
out.push('')
out.push(
  `WHY      : ${count('matched')} matched, ${count('quote_paraphrased')} right fact but quote paraphrased, ` +
    `${count('quote_elsewhere')} right fact but quote cites another passage, ${count('missed')} missed`,
)
const nearMisses = scored.reduce((n, s) => n + s.score.truth.filter((t) => t.nearMiss).length, 0)
out.push(`           (${nearMisses} of the misses state the fact but type an entity differently — see "near miss" below)`)
const { times } = combined
out.push(
  `TIMES    : on ${times.compared} right facts, start/end agree on ${times.agree}; ` +
    `of the ${times.dated} where either side gives a time, ${times.datedAgree} agree`,
)
for (const s of scored) {
  for (const t of s.score.truth) {
    if (t.timesAgree !== false) continue
    const e = s.score.extracted[t.extracted!]!.claim
    const span = (start?: string, end?: string) => `${start ?? '–'} → ${end ?? '–'}`
    out.push(`           ${s.seed}: ${stated(t.claim)} — truth ${span(t.claim.startTime, t.claim.endTime)}, extracted ${span(e.startTime, e.endTime)}`)
  }
}
const rejections = scored.reduce((n, s) => n + (s.fixture?.run.rejections.length ?? 0), 0)
out.push(`REJECTED : ${rejections} claim(s) refused by the validator before scoring (not counted)`)

out.push('')
const predW = [18, ...TALLY_W]
out.push(row(['PREDICATE', ...TALLY_HEAD], predW))
for (const [p, t] of Object.entries(combined.byPredicate).sort(([a], [b]) => a.localeCompare(b))) {
  out.push(row([p, ...tallyCells(t)], predW))
}
out.push('  Inverse pairs are counted under the direction the registry declares (ruled_by under rules).')

out.push('')
out.push('NOT MATCHED IN FULL — ground-truth claims')
for (const s of scored) {
  for (const t of s.score.truth) {
    if (t.outcome === 'matched') continue
    out.push(`  ${s.seed.padEnd(6)} ¶${String(t.claim.paragraph).padEnd(3)} ${stated(t.claim)}  — ${describeTruth(t, s.score.extracted)}`)
  }
}

out.push('')
out.push('UNMATCHED — extracted claims no ground-truth claim accounts for.')
out.push('  Not necessarily wrong: the ground truth is what one person labelled, and may be incomplete.')
for (const s of scored) {
  for (const e of s.score.extracted) {
    if (e.outcome !== 'unmatched') continue
    const where = e.claim.paragraphIndex === undefined ? '¶?  ' : `¶${String(e.claim.paragraphIndex).padEnd(3)}`
    out.push(`  ${s.seed.padEnd(6)} ${where} ${statedExtracted(e.claim)}${e.verbatim ? '' : '  [quote not verbatim]'}`)
    out.push(`                 "${clip(e.claim.quote)}"`)
  }
}

console.log(out.join('\n'))

function describeTruth(t: TruthResult, extracted: ExtractedResult[]): string {
  const paired = t.extracted === undefined ? undefined : extracted[t.extracted]!.claim
  switch (t.outcome) {
    case 'quote_paraphrased':
      return `fact right, quote not in the document: "${clip(paired!.quote, 70)}"`
    case 'quote_elsewhere':
      return `fact right, quote cites another passage: "${clip(paired!.quote, 70)}"`
    default:
      return t.nearMiss ? `missed (near miss: ${t.nearMiss.reason})` : 'missed'
  }
}

/* ---------------------------------------------------------------------- json */

if (asJson) {
  const resultDir = join('corpus', 'scoring', 'results')
  mkdirSync(resultDir, { recursive: true })
  const result = {
    runLabel: label,
    scoredAt: new Date().toISOString(),
    rule: { minSharedChars: MIN_SHARED_CHARS },
    total: { ...combined.total, ...rates(combined.total) },
    times: combined.times,
    byPredicate: Object.fromEntries(Object.entries(combined.byPredicate).map(([p, t]) => [p, { ...t, ...rates(t) }])),
    documents: Object.fromEntries(
      scored.map((s) => [
        s.seed,
        {
          document: SEEDS[s.seed]!.name,
          failure: s.failure,
          model: s.fixture?.run.model ?? null,
          capturedAt: s.fixture?.capturedAt ?? null,
          systemPromptSha: s.fixture?.systemPromptSha ?? null,
          driveVersion: s.fixture?.driveVersion ?? null,
          total: { ...s.score.total, ...rates(s.score.total) },
          times: s.score.times,
          byPredicate: s.score.byPredicate,
          truth: s.score.truth,
          extracted: s.score.extracted,
        },
      ]),
    ),
  }
  const path = join(resultDir, `${label}.json`)
  writeFileSync(path, JSON.stringify(result, null, 2) + '\n')
  console.error(`\nwrote ${path}`)
}
