/**
 * The starting ontology vocabulary.
 *
 * This file is the single source of truth for three consumers:
 *
 *   1. the seeded rows in `entity_types` / `predicates` / `predicate_signatures`
 *   2. the Zod schema the extractor's output is validated against
 *   3. the predicate menu pasted into the extraction prompt
 *
 * They must not be allowed to drift, which is why they are derived rather than
 * written three times. Nothing here touches the database; `./seed.ts` does that.
 *
 * ## Sizing
 *
 * 23 relationship *concepts* and 21 attributes — 63 predicate rows and 241
 * signatures. Relationships are directional (ontology design: "symmetric
 * relationships will therefore have 2 claims each"), so the 23 concepts expand
 * to 42 rows: `RELATIONSHIPS` declares one direction and `deriveOntology()`
 * generates the other, which is why a signature cannot be mirrored incorrectly.
 *
 * This is deliberately a starting point, not a complete world model. Too small
 * and every extraction stalls on a missing verb; too large and the model picks
 * inconsistently between near-synonyms. The proposals queue (Phase 2B) is how
 * it grows — see docs/ontology-design.md.
 */

import type { PredicateKind, ValueType } from '@/db/schema'

export const NONE = '@none'

/* --------------------------------------------------------------- entity types */

export const ENTITY_TYPES = [
  { name: 'character', label: 'Character', pluralLabel: 'Characters', description: 'An individual person, being, or named actor.' },
  { name: 'faction', label: 'Faction', pluralLabel: 'Factions', description: 'An organised group pursuing shared aims — a guild, order, army, house, or cabal.' },
  { name: 'society', label: 'Society', pluralLabel: 'Societies', description: 'A polity or people considered as a whole: a kingdom, empire, tribe, or nation.' },
  { name: 'culture', label: 'Culture', pluralLabel: 'Cultures', description: 'A shared body of custom, language, and practice, which may span societies.' },
  { name: 'religion', label: 'Religion', pluralLabel: 'Religions', description: 'A faith, cult, or system of worship, including its institutions.' },
  { name: 'settlement', label: 'Settlement', pluralLabel: 'Settlements', description: 'An inhabited place — a city, town, village, keep, or outpost.' },
  { name: 'region', label: 'Region', pluralLabel: 'Regions', description: 'A geographic area: a continent, province, mountain range, sea, or wilderness.' },
  { name: 'artifact', label: 'Artifact', pluralLabel: 'Artifacts', description: 'A specific notable object — a weapon, relic, text, or regalia.' },
  { name: 'event', label: 'Event', pluralLabel: 'Events', description: 'A bounded happening: a battle, treaty, disaster, coronation, or discovery.' },
] as const satisfies readonly EntityTypeDef[]

export type EntityTypeName = (typeof ENTITY_TYPES)[number]['name']

export type EntityTypeDef = {
  name: string
  label: string
  pluralLabel: string
  description: string
}

/* -------------------------------------------------------------- relationships */

/** An ordered (subject type, object type) pair that this predicate accepts. */
type Pair = readonly [EntityTypeName, EntityTypeName]

type RelationshipDef = {
  name: string
  label: string
  description: string
  /**
   * The reverse direction. `symmetric: true` means the inverse is the predicate
   * itself (`married_to`), so only one row is generated.
   */
  inverse?: { name: string; label: string; description: string }
  symmetric?: boolean
  /** The relationship can start and stop holding. Phase 3 uses this to gate conflicts. */
  temporal?: boolean
  /** At most one object at a time. Phase 3 cardinality; nothing reads it yet. */
  functional?: boolean
  pairs: readonly Pair[]
}

const ALLIANCE_PAIRS = [
  ['character', 'character'],
  ['faction', 'faction'],
  ['society', 'society'],
  ['settlement', 'settlement'],
  ['religion', 'religion'],
  ['faction', 'society'],
  ['society', 'faction'],
] as const satisfies readonly Pair[]

export const RELATIONSHIPS = [
  {
    name: 'member_of',
    label: 'Member of',
    description: 'The subject belongs to the object as a member, citizen, or adherent.',
    inverse: { name: 'has_member', label: 'Has member', description: 'The object counts the subject among its members.' },
    temporal: true,
    pairs: [
      ['character', 'faction'],
      ['character', 'society'],
      ['character', 'religion'],
      ['character', 'culture'],
      ['faction', 'faction'],
      ['faction', 'society'],
      ['settlement', 'society'],
      ['settlement', 'faction'],
    ],
  },
  {
    name: 'leads',
    label: 'Leads',
    description: 'The subject holds command or headship of the object organisation. Use `rules` for sovereign authority over a place.',
    inverse: { name: 'led_by', label: 'Led by', description: 'The object organisation is commanded by the subject.' },
    temporal: true,
    functional: true,
    pairs: [
      ['character', 'faction'],
      ['character', 'religion'],
      ['character', 'society'],
    ],
  },
  {
    name: 'rules',
    label: 'Rules',
    description: 'The subject holds sovereign authority over the object place or people.',
    inverse: { name: 'ruled_by', label: 'Ruled by', description: 'The object is under the sovereign authority of the subject.' },
    temporal: true,
    functional: true,
    pairs: [
      ['character', 'settlement'],
      ['character', 'region'],
      ['character', 'society'],
      ['faction', 'settlement'],
      ['faction', 'region'],
      ['society', 'region'],
      ['society', 'settlement'],
    ],
  },
  {
    name: 'parent_of',
    label: 'Parent of',
    description: 'The subject is a biological or adoptive parent of the object.',
    inverse: { name: 'child_of', label: 'Child of', description: 'The subject is a child of the object.' },
    pairs: [['character', 'character']],
  },
  {
    name: 'sibling_of',
    label: 'Sibling of',
    description: 'The two characters share at least one parent.',
    symmetric: true,
    pairs: [['character', 'character']],
  },
  {
    name: 'married_to',
    label: 'Married to',
    description: 'The two characters are joined in marriage or an equivalent formal union.',
    symmetric: true,
    temporal: true,
    pairs: [['character', 'character']],
  },
  {
    name: 'ally_of',
    label: 'Ally of',
    description: 'The two parties are formally or practically allied.',
    symmetric: true,
    temporal: true,
    pairs: ALLIANCE_PAIRS,
  },
  {
    name: 'enemy_of',
    label: 'Enemy of',
    description: 'The two parties are in declared or open hostility.',
    symmetric: true,
    temporal: true,
    pairs: ALLIANCE_PAIRS,
  },
  {
    name: 'located_in',
    label: 'Located in',
    description: 'The subject sits geographically within the object.',
    inverse: { name: 'contains', label: 'Contains', description: 'The object lies geographically within the subject.' },
    functional: true,
    pairs: [
      ['settlement', 'region'],
      ['region', 'region'],
      ['artifact', 'settlement'],
      ['artifact', 'region'],
      ['faction', 'settlement'],
      ['faction', 'region'],
      ['event', 'settlement'],
      ['event', 'region'],
      ['religion', 'region'],
      ['culture', 'region'],
      ['society', 'region'],
    ],
  },
  {
    name: 'capital_of',
    label: 'Capital of',
    description: 'The subject settlement is the seat of government of the object.',
    inverse: { name: 'has_capital', label: 'Has capital', description: 'The subject is governed from the object settlement.' },
    temporal: true,
    functional: true,
    pairs: [
      ['settlement', 'society'],
      ['settlement', 'region'],
      ['settlement', 'faction'],
    ],
  },
  {
    name: 'born_in',
    label: 'Born in',
    description: 'The character was born at the object place.',
    inverse: { name: 'birthplace_of', label: 'Birthplace of', description: 'The subject place is where the object character was born.' },
    functional: true,
    pairs: [
      ['character', 'settlement'],
      ['character', 'region'],
    ],
  },
  {
    name: 'died_in',
    label: 'Died in',
    description: 'The character died at the object place.',
    inverse: { name: 'death_place_of', label: 'Death place of', description: 'The subject place is where the object character died.' },
    functional: true,
    pairs: [
      ['character', 'settlement'],
      ['character', 'region'],
    ],
  },
  {
    name: 'resides_in',
    label: 'Resides in',
    description: 'The character dwells at the object place. Use `born_in` / `died_in` for those specific facts.',
    inverse: { name: 'residence_of', label: 'Residence of', description: 'The subject place is home to the object character.' },
    temporal: true,
    functional: true,
    pairs: [
      ['character', 'settlement'],
      ['character', 'region'],
    ],
  },
  {
    name: 'founded',
    label: 'Founded',
    description: 'The subject established the object.',
    inverse: { name: 'founded_by', label: 'Founded by', description: 'The subject was established by the object.' },
    pairs: [
      ['character', 'settlement'],
      ['character', 'faction'],
      ['character', 'religion'],
      ['character', 'society'],
      ['faction', 'settlement'],
      ['society', 'settlement'],
    ],
  },
  {
    name: 'created',
    label: 'Created',
    description: 'The subject made or authored the object artifact.',
    inverse: { name: 'created_by', label: 'Created by', description: 'The subject artifact was made or authored by the object.' },
    pairs: [
      ['character', 'artifact'],
      ['faction', 'artifact'],
      ['culture', 'artifact'],
      ['society', 'artifact'],
    ],
  },
  {
    name: 'owns',
    label: 'Owns',
    description: 'The subject possesses or bears the object artifact.',
    inverse: { name: 'owned_by', label: 'Owned by', description: 'The subject artifact is possessed by the object.' },
    temporal: true,
    pairs: [
      ['character', 'artifact'],
      ['faction', 'artifact'],
      ['settlement', 'artifact'],
      ['religion', 'artifact'],
      ['society', 'artifact'],
    ],
  },
  {
    name: 'worships',
    label: 'Worships',
    description: 'The subject venerates the object religion or its figures.',
    inverse: { name: 'worshipped_by', label: 'Worshipped by', description: 'The subject religion is venerated by the object.' },
    temporal: true,
    pairs: [
      ['character', 'religion'],
      ['society', 'religion'],
      ['settlement', 'religion'],
      ['culture', 'religion'],
      ['faction', 'religion'],
      ['region', 'religion'],
    ],
  },
  {
    name: 'practices',
    label: 'Practices',
    description: 'The subject observes the customs of the object culture.',
    inverse: { name: 'practiced_by', label: 'Practiced by', description: 'The subject culture is observed by the object.' },
    temporal: true,
    pairs: [
      ['character', 'culture'],
      ['society', 'culture'],
      ['settlement', 'culture'],
      ['faction', 'culture'],
      ['region', 'culture'],
    ],
  },
  {
    name: 'participated_in',
    label: 'Participated in',
    description: 'The subject took an active part in the object event.',
    inverse: { name: 'had_participant', label: 'Had participant', description: 'The subject event involved the object as a participant.' },
    pairs: [
      ['character', 'event'],
      ['faction', 'event'],
      ['society', 'event'],
      ['settlement', 'event'],
      ['region', 'event'],
      ['religion', 'event'],
      ['artifact', 'event'],
    ],
  },
  {
    name: 'caused',
    label: 'Caused',
    description: 'The subject brought about the object event. Use `preceded_by` for mere sequence.',
    inverse: { name: 'caused_by', label: 'Caused by', description: 'The subject event was brought about by the object.' },
    pairs: [
      ['event', 'event'],
      ['character', 'event'],
      ['faction', 'event'],
      ['society', 'event'],
      ['artifact', 'event'],
    ],
  },
  {
    name: 'preceded_by',
    label: 'Preceded by',
    description: 'The subject event happened after the object event, without implying causation.',
    inverse: { name: 'followed_by', label: 'Followed by', description: 'The subject event happened before the object event.' },
    pairs: [['event', 'event']],
  },
  {
    name: 'successor_of',
    label: 'Successor of',
    description: 'The subject took over the office, title, or role previously held by the object.',
    inverse: { name: 'predecessor_of', label: 'Predecessor of', description: 'The subject previously held the office, title, or role the object took over.' },
    pairs: [
      ['character', 'character'],
      ['faction', 'faction'],
      ['society', 'society'],
      ['religion', 'religion'],
    ],
  },
  {
    name: 'serves',
    label: 'Serves',
    description: 'The subject is sworn, bound, or employed in the service of the object.',
    inverse: { name: 'served_by', label: 'Served by', description: 'The object is in the service of the subject.' },
    temporal: true,
    pairs: [
      ['character', 'character'],
      ['character', 'faction'],
      ['character', 'society'],
      ['faction', 'society'],
      ['faction', 'character'],
    ],
  },
] as const satisfies readonly RelationshipDef[]

/* ----------------------------------------------------------------- attributes */

type AttributeDef = {
  name: string
  label: string
  description: string
  valueType: ValueType
  /** Closed value set. Enforced in the Zod layer, not the database. */
  values?: readonly string[]
  unit?: string
  temporal?: boolean
  functional?: boolean
  subjects: readonly EntityTypeName[]
}

const ALL_TYPES = ENTITY_TYPES.map((t) => t.name) as readonly EntityTypeName[]

export const ATTRIBUTES = [
  { name: 'description', label: 'Description', description: 'A short prose characterisation of the entity.', valueType: 'string', subjects: ALL_TYPES },
  { name: 'title', label: 'Title', description: 'A formal title or office held: "Queen of Ashfall", "High Cantor".', valueType: 'string', temporal: true, subjects: ['character'] },
  { name: 'epithet', label: 'Epithet', description: 'A byname or descriptive tag: "the Unbroken", "the Drowned City".', valueType: 'string', subjects: ['character', 'settlement', 'artifact', 'region'] },
  { name: 'species', label: 'Species', description: 'The kind of being the character is, in the world\'s own terms.', valueType: 'string', functional: true, subjects: ['character'] },
  { name: 'gender', label: 'Gender', description: 'The character\'s gender as the source material states it.', valueType: 'string', subjects: ['character'] },
  { name: 'occupation', label: 'Occupation', description: 'Trade, profession, or vocation.', valueType: 'string', temporal: true, subjects: ['character'] },
  { name: 'rank', label: 'Rank', description: 'Position within a hierarchy: military, clerical, or noble.', valueType: 'string', temporal: true, subjects: ['character'] },
  { name: 'vital_status', label: 'Vital status', description: 'Whether the character is alive at the latest point the sources cover.', valueType: 'string', values: ['alive', 'dead', 'missing', 'unknown'], functional: true, subjects: ['character'] },
  { name: 'age', label: 'Age', description: 'Age in the world\'s years. Prefer `birth_date` when a date is given.', valueType: 'int', temporal: true, subjects: ['character'] },
  { name: 'birth_date', label: 'Birth date', description: 'In-world date of birth, verbatim as the source gives it.', valueType: 'date', functional: true, subjects: ['character'] },
  { name: 'death_date', label: 'Death date', description: 'In-world date of death, verbatim as the source gives it.', valueType: 'date', functional: true, subjects: ['character'] },
  { name: 'founded_on', label: 'Founded on', description: 'In-world date the entity was established.', valueType: 'date', functional: true, subjects: ['settlement', 'faction', 'society', 'religion', 'culture'] },
  { name: 'dissolved_on', label: 'Dissolved on', description: 'In-world date the entity ceased to exist.', valueType: 'date', functional: true, subjects: ['settlement', 'faction', 'society', 'religion', 'culture'] },
  { name: 'occurred_on', label: 'Occurred on', description: 'In-world date the event took place.', valueType: 'date', functional: true, subjects: ['event'] },
  { name: 'outcome', label: 'Outcome', description: 'How the event resolved, and for whom.', valueType: 'string', subjects: ['event'] },
  { name: 'population', label: 'Population', description: 'Number of inhabitants or members.', valueType: 'int', temporal: true, subjects: ['settlement', 'region', 'society', 'faction', 'culture', 'religion'] },
  { name: 'government_type', label: 'Government type', description: 'The form of rule: monarchy, council, theocracy, and so on.', valueType: 'string', temporal: true, functional: true, subjects: ['society', 'settlement', 'region', 'faction'] },
  { name: 'motto', label: 'Motto', description: 'A words-of-the-house style phrase.', valueType: 'string', subjects: ['faction', 'society', 'settlement', 'religion'] },
  { name: 'terrain', label: 'Terrain', description: 'Dominant landscape or climate of the region.', valueType: 'string', subjects: ['region'] },
  { name: 'material', label: 'Material', description: 'What the artifact is made of.', valueType: 'string', subjects: ['artifact'] },
  { name: 'power', label: 'Power', description: 'A magical or supernatural property the artifact possesses.', valueType: 'string', subjects: ['artifact'] },
] as const satisfies readonly AttributeDef[]

/* ----------------------------------------------------------------- derivation */

export type PredicateRow = {
  name: string
  kind: PredicateKind
  label: string
  description: string
  inverseName: string | null
  isSymmetric: boolean
  isTemporal: boolean
  isFunctional: boolean
  valueType: ValueType | null
  valueEnum: string[] | null
  unit: string | null
}

export type SignatureRow = {
  predicate: string
  subjectType: string
  /** A real entity type, or NONE for an attribute. */
  objectType: string
  /** A ValueType, or NONE for a relationship. */
  valueKind: string
}

/**
 * Expands the concept-level declarations above into the flat rows the three
 * reference tables hold. The inverse direction — predicate row *and* mirrored
 * signatures — is generated rather than written out, so the two directions of a
 * relationship cannot disagree about which types they accept.
 */
export function deriveOntology(): { predicates: PredicateRow[]; signatures: SignatureRow[] } {
  const predicateRows: PredicateRow[] = []
  const signatureRows: SignatureRow[] = []

  for (const rel of RELATIONSHIPS) {
    const symmetric = 'symmetric' in rel && rel.symmetric === true
    const inverse = 'inverse' in rel ? rel.inverse : undefined

    predicateRows.push({
      name: rel.name,
      kind: 'relationship',
      label: rel.label,
      description: rel.description,
      inverseName: symmetric ? rel.name : (inverse?.name ?? null),
      isSymmetric: symmetric,
      isTemporal: 'temporal' in rel && rel.temporal === true,
      isFunctional: 'functional' in rel && rel.functional === true,
      valueType: null,
      valueEnum: null,
      unit: null,
    })

    for (const [subject, object] of rel.pairs) {
      signatureRows.push({ predicate: rel.name, subjectType: subject, objectType: object, valueKind: NONE })
      // A symmetric predicate must accept the pair read backwards too, or the
      // reciprocal claim the extractor is told to write would be rejected.
      if (symmetric) {
        signatureRows.push({ predicate: rel.name, subjectType: object, objectType: subject, valueKind: NONE })
      }
    }

    if (!symmetric && inverse) {
      predicateRows.push({
        name: inverse.name,
        kind: 'relationship',
        label: inverse.label,
        description: inverse.description,
        inverseName: rel.name,
        isSymmetric: false,
        isTemporal: 'temporal' in rel && rel.temporal === true,
        // Functionality does not survive inversion: one settlement has one
        // ruler, but one ruler may hold several settlements.
        isFunctional: false,
        valueType: null,
        valueEnum: null,
        unit: null,
      })

      for (const [subject, object] of rel.pairs) {
        signatureRows.push({ predicate: inverse.name, subjectType: object, objectType: subject, valueKind: NONE })
      }
    }
  }

  for (const attr of ATTRIBUTES) {
    predicateRows.push({
      name: attr.name,
      kind: 'attribute',
      label: attr.label,
      description: attr.description,
      inverseName: null,
      isSymmetric: false,
      isTemporal: 'temporal' in attr && attr.temporal === true,
      isFunctional: 'functional' in attr && attr.functional === true,
      valueType: attr.valueType,
      valueEnum: 'values' in attr && attr.values ? [...attr.values] : null,
      // No attribute in the starting set carries a unit, so the const assertion
      // narrows the property away entirely; widen to read it.
      unit: (attr as AttributeDef).unit ?? null,
    })

    for (const subject of attr.subjects) {
      signatureRows.push({ predicate: attr.name, subjectType: subject, objectType: NONE, valueKind: attr.valueType })
    }
  }

  return { predicates: predicateRows, signatures: dedupeSignatures(signatureRows) }
}

/** Symmetric predicates over same-type pairs generate the same row twice. */
function dedupeSignatures(rows: SignatureRow[]): SignatureRow[] {
  const seen = new Set<string>()
  return rows.filter((r) => {
    const key = `${r.predicate}|${r.subjectType}|${r.objectType}|${r.valueKind}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
