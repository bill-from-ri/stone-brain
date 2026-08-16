/**
 * The contract between the extraction model and the claims table.
 *
 * What an LLM emits is not a claim row: it writes entity *names*, not UUIDs, it
 * has no `user_id`, and its dates are labels rather than sort keys. So there is
 * a wire format in between, and this module owns it — the schema the model is
 * given, the validation its output must survive, and the translation into
 * something the entity matcher can turn into rows.
 *
 * ## Why this exists when the database already enforces the ontology
 *
 * The catalog can only answer yes or no, one row at a time, after the model has
 * already been paid for. This layer:
 *
 *   - rejects per claim, so two bad claims out of thirty cost two claims
 *   - produces errors a retry can act on ("'governs' is not in the vocabulary;
 *     closest: rules, ruled_by") rather than `claims_signature_fk`
 *   - checks what the catalog structurally cannot — `value_enum` membership
 *   - refuses fields the model invented, instead of dropping them silently
 *   - generates the vocabulary description and JSON Schema for the prompt
 *
 * It is the working surface, not the authority. It may be wrong, improved, or
 * bypassed; the foreign keys in src/db/schema.ts are the thing that cannot be.
 *
 * ## One source of truth
 *
 * The seeded reference tables, this validator, and the prompt text all derive
 * from the same ontology. Written separately they would drift, and the failure
 * is silent: the prompt offers a predicate the validator rejects, extraction
 * quietly produces nothing, and it reads as a bad model rather than a bug.
 *
 * `compileOntology()` therefore takes rows rather than importing the registry,
 * so the runtime can compile a user's *edited* vocabulary out of the database
 * while tests compile the registry directly.
 */

import { z } from 'zod'
import type { ValueType } from '@/db/schema'
import { ordinalFor } from './calendar'
import { type PredicateRow, type SignatureRow, NONE, deriveOntology } from './registry'

/* ------------------------------------------------------------------ compiling */

export type Ontology = {
  entityTypes: readonly string[]
  predicates: readonly PredicateRow[]
  signatures: readonly SignatureRow[]
}

export type CompiledOntology = {
  entityTypes: string[]
  predicateNames: string[]
  byName: Map<string, PredicateRow>
  /** predicate → legal subject types. */
  subjects: Map<string, Set<string>>
  /** `predicate|subjectType` → legal object types. Empty for attributes. */
  objects: Map<string, Set<string>>
}

const objectKey = (predicate: string, subjectType: string) => `${predicate}|${subjectType}`

export function compileOntology(ontology: Ontology): CompiledOntology {
  const byName = new Map(ontology.predicates.map((p) => [p.name, p]))
  const subjects = new Map<string, Set<string>>()
  const objects = new Map<string, Set<string>>()

  for (const s of ontology.signatures) {
    if (!byName.has(s.predicate)) continue
    if (!subjects.has(s.predicate)) subjects.set(s.predicate, new Set())
    subjects.get(s.predicate)!.add(s.subjectType)

    if (s.objectType === NONE) continue
    const key = objectKey(s.predicate, s.subjectType)
    if (!objects.has(key)) objects.set(key, new Set())
    objects.get(key)!.add(s.objectType)
  }

  return {
    entityTypes: [...ontology.entityTypes],
    // Sorted so the prompt, the JSON Schema and the error suggestions are all
    // stable across runs — a reordered enum is a cache miss for no reason.
    predicateNames: [...byName.keys()].sort(),
    byName,
    subjects,
    objects,
  }
}

/** The core vocabulary, for tests and for a user who has not edited theirs. */
export function coreOntology(): CompiledOntology {
  const { predicates, signatures } = deriveOntology()
  return compileOntology({
    entityTypes: [...new Set(signatures.map((s) => s.subjectType))].sort(),
    predicates,
    signatures,
  })
}

/* -------------------------------------------------------------- the wire type */

/**
 * Flat rather than nested, and typed by the model rather than inferred later.
 *
 * Asking for `subject_type` looks like extra work for the model, but it is what
 * lets domain and range be checked here instead of after entity matching — and
 * a type that disagrees with the matched entity is itself a useful signal.
 */
export type ExtractedClaim = {
  subjectName: string
  subjectType: string
  predicate: string
  objectName?: string
  objectType?: string
  valueInt?: number
  valueFloat?: number
  valueString?: string
  valueTime?: string
  valueOrder?: number
  startTime?: string
  startOrder?: number
  endTime?: string
  endOrder?: number
  quote: string
  paragraphIndex?: number
}

export type Rejection = {
  /** Position in the model's array, so a retry can name the offending claim. */
  index: number
  code:
    | 'malformed'
    | 'unknown_predicate'
    | 'unknown_entity_type'
    | 'illegal_subject_type'
    | 'illegal_object_type'
    | 'wrong_shape'
    | 'wrong_value_type'
    | 'value_not_in_enum'
    | 'self_relation'
  message: string
  received: unknown
}

export type ParseResult = {
  claims: ExtractedClaim[]
  rejections: Rejection[]
}

/* ---------------------------------------------------------------- the schema */

function claimSchema(ontology: CompiledOntology) {
  const entityType = z.enum(ontology.entityTypes as [string, ...string[]])
  return z.strictObject({
    subject: z.string().trim().min(1),
    subject_type: entityType,
    predicate: z.enum(ontology.predicateNames as [string, ...string[]]),
    object: z.string().trim().min(1).optional(),
    object_type: entityType.optional(),
    // Numbers are accepted as strings too — models quote them constantly, and
    // refusing "12000" teaches nothing a retry can fix.
    value: z.union([z.string(), z.number()]).optional(),
    start_time: z.string().trim().min(1).optional(),
    end_time: z.string().trim().min(1).optional(),
    quote: z.string().trim().min(1),
    paragraph: z.number().int().nonnegative().optional(),
  })
}

/** What the model is asked to return. */
export function extractionSchema(ontology: CompiledOntology) {
  return z.strictObject({ claims: z.array(claimSchema(ontology)) })
}

export function extractionJsonSchema(ontology: CompiledOntology): unknown {
  return z.toJSONSchema(extractionSchema(ontology))
}

/* ------------------------------------------------------------- semantic pass */

type RawClaim = z.infer<ReturnType<typeof claimSchema>>

const asNumber = (value: string | number): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const trimmed = value.trim().replace(/,/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

const normalizeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '')

/**
 * Everything the enum cannot express: which combinations are legal, which value
 * column the predicate wants, and whether the claim is even the right shape.
 * Returns the row the entity matcher will consume, or the reason it cannot.
 */
function checkClaim(
  raw: RawClaim,
  index: number,
  ontology: CompiledOntology,
): { claim: ExtractedClaim } | { rejection: Rejection } {
  const reject = (code: Rejection['code'], message: string): { rejection: Rejection } => ({
    rejection: { index, code, message, received: raw },
  })

  const predicate = ontology.byName.get(raw.predicate)
  if (!predicate) {
    return reject('unknown_predicate', `'${raw.predicate}' is not in the vocabulary.`)
  }

  const isRelationship = predicate.kind === 'relationship'
  const hasObject = raw.object !== undefined
  const hasValue = raw.value !== undefined

  if (isRelationship && !hasObject) {
    return reject(
      'wrong_shape',
      `'${predicate.name}' is a relationship and needs an 'object' entity, not a 'value'.`,
    )
  }
  if (!isRelationship && !hasValue) {
    return reject(
      'wrong_shape',
      `'${predicate.name}' is an attribute and needs a 'value', not an 'object'.`,
    )
  }
  if (hasObject && hasValue) {
    return reject('wrong_shape', `A claim carries either an 'object' or a 'value', never both.`)
  }
  if (hasObject && raw.object_type === undefined) {
    return reject('wrong_shape', `'object_type' is required whenever 'object' is given.`)
  }

  const legalSubjects = ontology.subjects.get(predicate.name) ?? new Set<string>()
  if (!legalSubjects.has(raw.subject_type)) {
    return reject(
      'illegal_subject_type',
      `'${predicate.name}' does not accept a ${raw.subject_type} as subject. ` +
        `Legal subjects: ${[...legalSubjects].sort().join(', ')}.`,
    )
  }

  const claim: ExtractedClaim = {
    subjectName: raw.subject,
    subjectType: raw.subject_type,
    predicate: predicate.name,
    quote: raw.quote,
    ...(raw.paragraph !== undefined && { paragraphIndex: raw.paragraph }),
  }

  if (isRelationship) {
    const legalObjects = ontology.objects.get(objectKey(predicate.name, raw.subject_type)) ?? new Set<string>()
    if (!legalObjects.has(raw.object_type!)) {
      return reject(
        'illegal_object_type',
        `'${predicate.name}' from a ${raw.subject_type} does not accept a ${raw.object_type} ` +
          `as object. Legal objects: ${[...legalObjects].sort().join(', ')}.`,
      )
    }
    // Mirrors the claims_no_self_relation check; caught here because the matcher
    // would otherwise resolve both sides to one entity and fail at insert.
    if (
      raw.subject_type === raw.object_type &&
      normalizeName(raw.subject) === normalizeName(raw.object!)
    ) {
      return reject('self_relation', `'${predicate.name}' cannot relate '${raw.subject}' to itself.`)
    }
    claim.objectName = raw.object
    claim.objectType = raw.object_type
  } else {
    const failure = assignValue(claim, raw.value!, predicate)
    if (failure) return reject(failure.code, failure.message)
  }

  if (raw.start_time !== undefined) {
    claim.startTime = raw.start_time
    const order = ordinalFor(raw.start_time)
    if (order !== null) claim.startOrder = order
  }
  if (raw.end_time !== undefined) {
    claim.endTime = raw.end_time
    const order = ordinalFor(raw.end_time)
    if (order !== null) claim.endOrder = order
  }

  return { claim }
}

/**
 * Routes the model's single `value` into the column the predicate declares.
 *
 * An unreadable *date* is deliberately not a rejection — the label is stored
 * with a null ordinal, unordered but not lost (docs/calendar.md). A wrong
 * *type* is, because it would land in the wrong column and fail the signature
 * foreign key anyway.
 */
function assignValue(
  claim: ExtractedClaim,
  value: string | number,
  predicate: PredicateRow,
): { code: Rejection['code']; message: string } | null {
  const valueType = predicate.valueType as ValueType

  if (valueType === 'int' || valueType === 'float') {
    const n = asNumber(value)
    if (n === null) {
      return {
        code: 'wrong_value_type',
        message: `'${predicate.name}' takes ${valueType === 'int' ? 'a whole number' : 'a number'}; got ${JSON.stringify(value)}.`,
      }
    }
    if (valueType === 'int' && !Number.isInteger(n)) {
      return {
        code: 'wrong_value_type',
        message: `'${predicate.name}' takes a whole number; got ${n}.`,
      }
    }
    if (valueType === 'int') claim.valueInt = n
    else claim.valueFloat = n
    return null
  }

  if (typeof value !== 'string') {
    return {
      code: 'wrong_value_type',
      message: `'${predicate.name}' takes ${valueType === 'date' ? 'a date' : 'text'}; got the number ${value}.`,
    }
  }

  if (valueType === 'date') {
    claim.valueTime = value
    const order = ordinalFor(value)
    if (order !== null) claim.valueOrder = order
    return null
  }

  // The one rule the catalog cannot express — enforcing it in Postgres would
  // need a trigger, and Drizzle owns the schema (ADR §8, §15).
  if (predicate.valueEnum && !predicate.valueEnum.includes(value)) {
    return {
      code: 'value_not_in_enum',
      message: `'${predicate.name}' accepts only: ${predicate.valueEnum.join(', ')}. Got '${value}'.`,
    }
  }
  claim.valueString = value
  return null
}

/* ----------------------------------------------------------------- the entry */

/**
 * Validates a model response into claims the entity matcher can resolve.
 *
 * Each claim is parsed on its own rather than as an array, so one malformed
 * entry costs one claim instead of the whole document — the single most
 * valuable property of validating before the database sees anything.
 *
 * Never throws. A response that is not even the right shape comes back as a
 * single rejection, because that too is something the retry loop should be told
 * rather than something that should crash the extraction.
 */
export function parseExtraction(input: unknown, ontology: CompiledOntology): ParseResult {
  const claims: ExtractedClaim[] = []
  const rejections: Rejection[] = []

  const list = Array.isArray(input)
    ? input
    : input && typeof input === 'object' && Array.isArray((input as { claims?: unknown }).claims)
      ? (input as { claims: unknown[] }).claims
      : null

  if (!list) {
    return {
      claims,
      rejections: [
        {
          index: 0,
          code: 'malformed',
          message: `Expected an object of the form { "claims": [ … ] }.`,
          received: input,
        },
      ],
    }
  }

  const schema = claimSchema(ontology)

  for (const [index, entry] of list.entries()) {
    const parsed = schema.safeParse(entry)
    if (!parsed.success) {
      rejections.push({
        index,
        code: structuralCode(parsed.error),
        message: describeIssues(parsed.error, ontology, entry),
        received: entry,
      })
      continue
    }

    const checked = checkClaim(parsed.data, index, ontology)
    if ('claim' in checked) claims.push(checked.claim)
    else rejections.push(checked.rejection)
  }

  return { claims, rejections }
}

function structuralCode(error: z.ZodError): Rejection['code'] {
  for (const issue of error.issues) {
    const field = issue.path[0]
    if (field === 'predicate') return 'unknown_predicate'
    if (field === 'subject_type' || field === 'object_type') return 'unknown_entity_type'
  }
  return 'malformed'
}

/**
 * Zod's default text is written for a developer reading a stack trace. The
 * consumer here is a model being asked to try again, so an off-vocabulary
 * predicate gets the nearest real ones rather than a dump of all 63.
 */
function describeIssues(error: z.ZodError, ontology: CompiledOntology, entry: unknown): string {
  // Zod's enum issues carry the allowed values but not the rejected one, so the
  // offending text is read back out of the entry being validated.
  const received = (field: string): string =>
    String((entry as Record<string, unknown> | null)?.[field] ?? '')

  return error.issues
    .map((issue) => {
      const field = issue.path.join('.') || '(root)'

      if (issue.code === 'invalid_value' && field === 'predicate') {
        const got = received(field)
        const suggestions = closestNames(got, ontology.predicateNames)
        return suggestions.length
          ? `'${got}' is not in the vocabulary. Did you mean: ${suggestions.join(', ')}?`
          : `'${got}' is not in the vocabulary, and nothing in it is close. ` +
            `Use one of the listed predicates or drop the claim — do not substitute a near-synonym.`
      }
      if (issue.code === 'invalid_value' && (field === 'subject_type' || field === 'object_type')) {
        return `'${received(field)}' is not an entity type. Legal types: ${ontology.entityTypes.join(', ')}.`
      }
      if (issue.code === 'unrecognized_keys') {
        const keys = (issue as { keys?: string[] }).keys ?? []
        return `Unexpected field(s): ${keys.join(', ')}. Emit only the documented fields.`
      }
      return `${field}: ${issue.message}`
    })
    .join(' ')
}

/** Cheap edit distance — the candidate list is tens of names, not thousands. */
function distance(a: string, b: string): number {
  const rows = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let previous = rows[0]!
    rows[0] = i
    for (let j = 1; j <= b.length; j++) {
      const current = rows[j]!
      rows[j] = Math.min(
        rows[j]! + 1,
        rows[j - 1]! + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      previous = current
    }
  }
  return rows[b.length]!
}

/**
 * Near-misses only, and deliberately silent when there is no near miss.
 *
 * Edit distance finds typos — `ruledby` for `ruled_by` — which is the mistake a
 * model given an enum actually makes. It cannot find synonyms: the nearest
 * strings to `governs` are `owns` and `power`, and offering those would push
 * the model onto a wrong-but-legal predicate, which is worse than the invented
 * one because nothing downstream would ever flag it. So a genuine vocabulary
 * gap returns nothing, and the caller says so plainly.
 */
export function closestNames(target: string, candidates: string[], limit = 3): string[] {
  const needle = target.toLowerCase()
  const threshold = Math.max(2, Math.floor(needle.length / 3))
  return [...candidates]
    .map((name) => ({ name, d: distance(needle, name.toLowerCase()) }))
    .filter((c) => c.d <= threshold)
    .sort((a, b) => a.d - b.d || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((c) => c.name)
}

/* ----------------------------------------------------------------- the prompt */

/**
 * The vocabulary as the model sees it.
 *
 * Rendered from the same compiled ontology the validator uses, which is the
 * whole point: a predicate the prompt offers is a predicate the validator
 * accepts, by construction rather than by upkeep.
 */
export function describeVocabulary(ontology: CompiledOntology): string {
  const relationships: string[] = []
  const attributes: string[] = []

  for (const name of ontology.predicateNames) {
    const predicate = ontology.byName.get(name)!
    const subjects = [...(ontology.subjects.get(name) ?? [])].sort()

    if (predicate.kind === 'relationship') {
      const lines = subjects.map((subject) => {
        const objects = [...(ontology.objects.get(objectKey(name, subject)) ?? [])].sort()
        return `    ${subject} → ${objects.join(' | ')}`
      })
      relationships.push(`  ${name} — ${predicate.description}\n${lines.join('\n')}`)
    } else {
      const enumeration = predicate.valueEnum ? ` one of: ${predicate.valueEnum.join(' | ')}` : ''
      attributes.push(
        `  ${name} (${predicate.valueType})${enumeration} — ${predicate.description}\n` +
          `    subjects: ${subjects.join(', ')}`,
      )
    }
  }

  return [
    `ENTITY TYPES\n  ${ontology.entityTypes.join(', ')}`,
    `RELATIONSHIPS (subject → allowed object types)\n${relationships.join('\n')}`,
    `ATTRIBUTES\n${attributes.join('\n')}`,
  ].join('\n\n')
}
