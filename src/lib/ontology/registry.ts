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
 * 28 relationship *concepts* and 21 attributes — 73 predicate rows and 255
 * signatures, over 12 entity types. There is deliberately no `description`
 * attribute: an entity's prose description is `entities.summary`, one curated
 * line per entity rather than one competing claim per document. Relationships are directional (ontology
 * design: "symmetric relationships will therefore have 2 claims each"), so the
 * 28 concepts expand to 52 rows: `RELATIONSHIPS` declares one direction and
 * `deriveOntology()` generates the other, which is why a signature cannot be
 * mirrored incorrectly.
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
  { name: 'artifact', label: 'Artifact', pluralLabel: 'Artifacts', description: 'A specific notable object or created thing — a weapon, relic, text, regalia, or a made phenomenon such as a magical barrier.' },
  { name: 'event', label: 'Event', pluralLabel: 'Events', description: 'A bounded happening: a battle, treaty, disaster, coronation, or discovery.' },
  { name: 'commodity', label: 'Commodity', pluralLabel: 'Commodities', description: 'A class of traded or produced good — grain, salt, iron, silk. A kind of thing, not a particular object; a specific named object is an artifact.' },
  { name: 'deity', label: 'Deity', pluralLabel: 'Deities', description: 'A worshipped being — a god, saint, spirit, or venerated figure. May be the deified form of a real character (`incarnation_of`), or exist purely in belief.' },
  { name: 'species', label: 'Species', pluralLabel: 'Species', description: 'A kind of living being — a race such as humans, giants, or dragons, or a plant, animal, or monster — rather than an individual. A named individual is a character, linked to its species by `of_species`.' },
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
    // Deliberately not functional: many regions sit inside one region, and a
    // region can reasonably sit inside more than one.
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
      // A species' habitat: where it lives, not a single location.
      ['species', 'region'],
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
    /**
     * Characters and factions. Where dates exist, succession is derivable from
     * two `rules` claims and does not need saying — but prose gives succession
     * far more often than it gives years, and that is the case this exists for.
     * `faction → faction` covers dynastic succession (a ruling house following
     * the one it replaced) with no regnal dates — the Kaldian Empire's
     * Kalduin/Skrimir chain is the seed that reopened it. "Successor state" is
     * still out: society → society was too vague to be worth a predicate.
     */
    pairs: [
      ['character', 'character'],
      ['faction', 'faction'],
    ],
  },
  {
    name: 'produces',
    label: 'Produces',
    description: 'The subject grows, mines, or manufactures the object commodity.',
    inverse: { name: 'produced_by', label: 'Produced by', description: 'The subject commodity is grown, mined, or manufactured by the object.' },
    temporal: true,
    // Land produces; only an actor trades. Hence `region` here but not below.
    pairs: [
      ['society', 'commodity'],
      ['settlement', 'commodity'],
      ['region', 'commodity'],
      ['faction', 'commodity'],
    ],
  },
  {
    name: 'exports',
    label: 'Exports',
    description: 'The subject sells the object commodity abroad.',
    inverse: { name: 'exported_by', label: 'Exported by', description: 'The subject commodity is sold abroad by the object.' },
    temporal: true,
    pairs: [
      ['society', 'commodity'],
      ['settlement', 'commodity'],
      ['faction', 'commodity'],
    ],
  },
  {
    name: 'imports',
    label: 'Imports',
    description: 'The subject buys the object commodity from elsewhere.',
    inverse: { name: 'imported_by', label: 'Imported by', description: 'The subject commodity is bought from elsewhere by the object.' },
    temporal: true,
    pairs: [
      ['society', 'commodity'],
      ['settlement', 'commodity'],
      ['faction', 'commodity'],
    ],
  },
  {
    name: 'serves',
    label: 'Serves',
    description: 'The subject is sworn, bound, or employed in the service of the object.',
    inverse: { name: 'served_by', label: 'Served by', description: 'The object is in the service of the subject.' },
    temporal: true,
    // `society → society` carries both true vassalage (a kingdom under the aegis
    // of an empire) and a constituent subdivision serving the state it belongs
    // to — the Kaldian duchies and provinces are modelled as their own
    // societies within the Empire.
    pairs: [
      ['character', 'character'],
      ['character', 'faction'],
      ['character', 'society'],
      ['faction', 'society'],
      ['faction', 'character'],
      ['society', 'society'],
    ],
  },
  {
    name: 'incarnation_of',
    label: 'Incarnation of',
    description: 'The subject deity is the deified form of the object character. Omit for a deity born purely of belief, which corresponds to no real being.',
    inverse: { name: 'deified_as', label: 'Deified as', description: 'The object deity is the worshipped form of the subject character.' },
    pairs: [['deity', 'character']],
  },
  {
    // Replaces the old free-text `species` attribute: the kind of being is an
    // entity, so every dragon points at one `Dragon` rather than spelling it.
    name: 'of_species',
    label: 'Of species',
    description: 'The subject character is an individual of the object species — a dragon, a giant, a human.',
    inverse: { name: 'has_individual', label: 'Has individual', description: 'The object character is an individual of the subject species.' },
    functional: true,
    pairs: [['character', 'species']],
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

export const ATTRIBUTES = [
  { name: 'title', label: 'Title', description: 'A formal title or office held: "Queen of Ashfall", "High Cantor".', valueType: 'string', temporal: true, subjects: ['character'] },
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
  { name: 'language', label: 'Language', description: 'A language spoken officially or in common use. Not attached to regions — land has no tongue; the people on it do.', valueType: 'string', temporal: true, subjects: ['society', 'culture'] },
  /**
   * `climate` and `landform` replace a single free-text `terrain`, which
   * conflated two independent facts — the Great Steppe is a *plateau* whose
   * climate is *steppe*. The landform list is strictly geomorphological and
   * carries no vegetation terms, so the two vocabularies cannot overlap.
   *
   * Both are optional, and an absent claim is not a gap to be filled: a region
   * spanning several biomes should have no `climate` at all, and neither should
   * one whose climate is undecided.
   */
  { name: 'climate', label: 'Climate', description: 'The dominant climate or biome. Leave unset for a region large enough to span several.', valueType: 'string', functional: true, values: ['ice_cap', 'tundra', 'alpine', 'boreal_forest', 'temperate_rainforest', 'temperate_forest', 'temperate_grassland', 'steppe', 'mediterranean', 'semi_arid', 'desert', 'savanna', 'tropical_seasonal_forest', 'tropical_rainforest', 'wetland'], subjects: ['region'] },
  { name: 'landform', label: 'Landform', description: 'The physical kind of place this is. Purely geomorphological — vegetation belongs to `climate`.', valueType: 'string', functional: true, values: ['continent', 'island', 'archipelago', 'peninsula', 'isthmus', 'coast', 'mountain_range', 'hills', 'plateau', 'plain', 'basin', 'valley', 'canyon', 'sea', 'gulf', 'strait', 'lake', 'river', 'marsh'], subjects: ['region'] },
  /**
   * Societies, not regions. Land is not agrarian — the state that farms it is.
   * A basin can be a bread basket without anyone having decided who rules it,
   * and that fact belongs to `produces`, not here.
   */
  { name: 'economy', label: 'Economy', description: 'What the society principally lives on.', valueType: 'string', values: ['agrarian', 'pastoral', 'mercantile', 'maritime'], temporal: true, functional: true, subjects: ['society'] },
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
