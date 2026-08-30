import { and, eq } from 'drizzle-orm'
import type { NeonDatabase } from 'drizzle-orm/neon-serverless'
import type * as schema from '@/db/schema'
import { claimSources, claims, documents, entities } from '@/db/schema'
import { ordinalFor } from './calendar'
import { normalizeName } from './matcher'
import { deriveOntology } from './registry'

/**
 * Hand-authored world data, and the loader that writes it.
 *
 * These claims are **ground truth for the Phase 2B bake-off**, which is the
 * whole reason they are written by hand. Generate them with a model and the
 * bake-off compares a model to itself and always passes.
 *
 * Everything here is `created_by: 'seed'` and `canonicity: 'canon'` — read from
 * a real document by a human, unlike an extractor's output, which lands as
 * `draft`. Re-running is safe: entities match on `(user, type, normalized
 * name)` and claims on the generated `fingerprint`.
 */

type Db = NeonDatabase<typeof schema>

export type SeedEntity = {
  name: string
  type: string
  variants?: string[]
  summary?: string
}

export type SeedClaim = {
  subject: string
  predicate: string
  /** Relationship claims. */
  object?: string
  /** Attribute claims — routed by the predicate's declared value type. */
  value?: string | number
  startTime?: string
  endTime?: string
  quote: string
  paragraph: number
  /** Why this is a reading rather than a quote. Recorded, not enforced. */
  inferred?: string
}

/* --------------------------------------------------------------- the source */

export const SEED_DOCUMENT = {
  name: 'Written Map (1012)',
  driveFileId: '1mwSYOWS2mYlek85iPpehPoFWzUgo8qwW01OtmKAiv3A',
} as const

/* -------------------------------------------------------------- the entities */

export const SEED_ENTITIES: SeedEntity[] = [
  // Regions. Nevlos is the world itself; the west/central/east subregions that
  // will give this a hierarchy do not exist yet, so nothing is located_in it.
  { name: 'Nevlos', type: 'region', summary: 'The known world.' },
  { name: 'Elduin', type: 'region' },
  { name: 'Frost Gulf', type: 'region', summary: 'The bay itself. The forested land around it is Runara.' },
  {
    name: 'Runara',
    type: 'region',
    // The document says "Frost Gulf" for both the water and the land it waters.
    // Resolving that string therefore returns two candidates — deliberate, and
    // the first live case of the entity matcher's ambiguous path.
    variants: ['Frost Gulf'],
    summary: 'The forested land around the Frost Gulf.',
  },
  { name: 'Enua', type: 'region', variants: ['Nethros'] },
  { name: 'Zada Mountains', type: 'region' },
  { name: 'Orosh Mountains', type: 'region' },
  { name: 'Lagetan Basin', type: 'region' },
  { name: 'Ipherian Sea', type: 'region' },
  { name: 'Ipheria', type: 'region' },
  { name: 'Merovia', type: 'region' },
  { name: 'Agyros', type: 'region' },
  { name: 'Ephria', type: 'region' },
  { name: 'Southern Ephria', type: 'region' },
  { name: 'Kovnia', type: 'region' },
  { name: 'Akál', type: 'region', variants: ['Akali Archipelago'] },
  { name: 'Sea of Akál', type: 'region' },
  { name: 'Yeosin Frontier', type: 'region', summary: 'A political march rather than a landform.' },
  { name: 'Central Plain', type: 'region' },
  { name: 'Great Steppe', type: 'region' },

  { name: 'Ipherian Empire', type: 'society' },
  { name: 'Tavilaga', type: 'society' },
  { name: 'Central Empire', type: 'society' },

  { name: 'Syrath', type: 'character' },
  { name: 'Vaski', type: 'character', summary: 'The last of the giants.' },

  {
    name: 'The Doom',
    type: 'event',
    summary: 'The event the world dates itself from. Not described here beyond its use as an epoch.',
  },
  { name: 'The Enu Conquests', type: 'event' },

  {
    name: "The Dragon's Shroud",
    type: 'artifact',
    summary:
      'A colossal circular wall of dense magical fog, created by Syrath in the dragon’s final ' +
      'moments with the intention of trapping Vaski within it.',
  },

  { name: 'Grain', type: 'commodity' },
]

/* ---------------------------------------------------------------- the claims */

const Q = {
  shroud:
    'Centered on the island of Elduin, the Dragon’s Shroud is a colossal, circular wall of dense, ' +
    'magical fog that separates those within it from those living beyond its borders. It was ' +
    'created by Syrath during the dragon’s final moments, with the intention of trapping Vaski, ' +
    'the last of the giants, within its confines.',
  gulf:
    'Once connected to the open ocean, the mouth of this vast bay is now closed by the Dragon’s ' +
    'Shroud. It is a densely forested region, watered by moisture that gets blown eastward off ' +
    'the Dragon’s Shroud.',
  enua:
    'Prior to the Enu Conquests of the 3rd century, this peninsula was known as Nethros. Its ' +
    'primary geographic features are two parallel mountain ranges (the Zada Mountains in the west ' +
    'and the Orosh Mountains in the northeast) that drain meltwater into the Lagetan Basin, a ' +
    'bread basket that has fed civilizations since long before the Doom.',
  ipheria:
    'Once united by the Ipherian Empire, this region splintered into successor states in the ' +
    'centuries following the Doom.',
  ephria:
    'Historically isolated from its northerly neighbors, the southern portion of Nevlos’ second, ' +
    'smaller continent is home to tropical rainforests and savannahs.',
  akal:
    'Located off the southeastern coast of the continent, the Akali Archipelago is a large ' +
    'cluster of islands home to various seafaring peoples. Although generally decentralized, they ' +
    'were once united by the mighty seafaring empire of Tavilaga.',
  central:
    'Dominating the eastern seaboard of the continent, the Central Empire is a multi-cultural ' +
    'hegemony spanning from the Yeosin Frontier in the north to the Sea of Akál in the south. ' +
    'Centered on a highly productive river basin called the Central Plain.',
  steppe:
    'At the center of the continent is a massive, grassy plateau known as the Great Steppe.',
} as const

export const SEED_CLAIMS: SeedClaim[] = [
  /* ¶3 — the Dragon's Shroud */
  { subject: "The Dragon's Shroud", predicate: 'created_by', object: 'Syrath', quote: Q.shroud, paragraph: 3 },
  {
    subject: "The Dragon's Shroud",
    predicate: 'located_in',
    object: 'Elduin',
    quote: Q.shroud,
    paragraph: 3,
    inferred: '"centered on" is approximated as containment; there is no spatial predicate for it',
  },
  { subject: 'Elduin', predicate: 'landform', value: 'island', quote: Q.shroud, paragraph: 3 },
  { subject: 'Syrath', predicate: 'species', value: 'dragon', quote: Q.shroud, paragraph: 3 },
  {
    subject: 'Syrath',
    predicate: 'vital_status',
    value: 'dead',
    quote: Q.shroud,
    paragraph: 3,
    inferred: '"during the dragon’s final moments" implies but does not state death',
  },
  { subject: 'Vaski', predicate: 'species', value: 'giant', quote: Q.shroud, paragraph: 3 },

  /* ¶5 — the Frost Gulf and Runara. No climate on the water. */
  { subject: 'Frost Gulf', predicate: 'landform', value: 'gulf', quote: Q.gulf, paragraph: 5 },
  { subject: 'Runara', predicate: 'climate', value: 'temperate_rainforest', quote: Q.gulf, paragraph: 5 },

  /* ¶7 — Enua */
  { subject: 'Enua', predicate: 'landform', value: 'peninsula', quote: Q.enua, paragraph: 7 },
  { subject: 'Zada Mountains', predicate: 'located_in', object: 'Enua', quote: Q.enua, paragraph: 7 },
  { subject: 'Zada Mountains', predicate: 'landform', value: 'mountain_range', quote: Q.enua, paragraph: 7 },
  { subject: 'Orosh Mountains', predicate: 'located_in', object: 'Enua', quote: Q.enua, paragraph: 7 },
  { subject: 'Orosh Mountains', predicate: 'landform', value: 'mountain_range', quote: Q.enua, paragraph: 7 },
  { subject: 'Lagetan Basin', predicate: 'located_in', object: 'Enua', quote: Q.enua, paragraph: 7 },
  { subject: 'Lagetan Basin', predicate: 'landform', value: 'basin', quote: Q.enua, paragraph: 7 },
  {
    subject: 'Lagetan Basin',
    predicate: 'produces',
    object: 'Grain',
    quote: Q.enua,
    paragraph: 7,
    inferred: '"a bread basket" implies grain without naming it',
  },
  {
    subject: 'The Enu Conquests',
    predicate: 'occurred_on',
    // The label the document used, verbatim. The parser resolves it to AD 201,
    // the earliest year the century contains — see docs/calendar.md.
    value: '3rd century',
    quote: Q.enua,
    paragraph: 7,
  },

  /* ¶9 — the Ipherian Sea */
  { subject: 'Ipherian Sea', predicate: 'landform', value: 'sea', quote: Q.ipheria, paragraph: 9 },
  {
    subject: 'Ipherian Empire',
    predicate: 'rules',
    object: 'Ipherian Sea',
    quote: Q.ipheria,
    paragraph: 9,
    inferred: '"once united by" says the rule has ended but gives no date, so no end_time is set',
  },

  /* ¶11 — Ephria. No climate on Southern Ephria: it spans several biomes. */
  { subject: 'Ephria', predicate: 'landform', value: 'continent', quote: Q.ephria, paragraph: 11 },
  { subject: 'Southern Ephria', predicate: 'located_in', object: 'Ephria', quote: Q.ephria, paragraph: 11 },

  /* ¶15 — Akál */
  { subject: 'Akál', predicate: 'landform', value: 'archipelago', quote: Q.akal, paragraph: 15 },
  {
    subject: 'Tavilaga',
    predicate: 'rules',
    object: 'Akál',
    quote: Q.akal,
    paragraph: 15,
    inferred: '"were once united by" gives an end without a date',
  },
  {
    subject: 'Tavilaga',
    predicate: 'economy',
    value: 'maritime',
    quote: Q.akal,
    paragraph: 15,
    inferred: '"the mighty seafaring empire" read as a maritime economy',
  },

  /* ¶17 — the Central Empire */
  { subject: 'Central Plain', predicate: 'landform', value: 'plain', quote: Q.central, paragraph: 17 },
  { subject: 'Central Empire', predicate: 'rules', object: 'Central Plain', quote: Q.central, paragraph: 17 },

  /* ¶19 — the Great Steppe. Landform and climate are genuinely different facts here. */
  { subject: 'Great Steppe', predicate: 'landform', value: 'plateau', quote: Q.steppe, paragraph: 19 },
  { subject: 'Great Steppe', predicate: 'climate', value: 'steppe', quote: Q.steppe, paragraph: 19 },
]

/* ---------------------------------------------------------------- the loader */

export type WorldSeedReport = {
  entitiesCreated: number
  entitiesExisting: number
  claimsCreated: number
  claimsExisting: number
  documentId: string | null
}

export async function seedWorld(db: Db, userId: string): Promise<WorldSeedReport> {
  return loadSeed(db, userId, SEED_DOCUMENT, SEED_ENTITIES, SEED_CLAIMS)
}

/**
 * The reusable loader behind every hand-seeded document.
 *
 * `seedWorld` (Written Map) and `seedKaldia` (The Kaldian Empire) are the same
 * insert logic over different data, so it lives here once: entities match on
 * `(user, type, normalized name)` and are reused across documents — which is
 * how "Elduin" and "Grain", first seeded from Written Map, are found rather than
 * duplicated when a second document names them. Claims match on the generated
 * `fingerprint`. Re-running any seed is a no-op.
 */
export async function loadSeed(
  db: Db,
  userId: string,
  source: { name: string; driveFileId: string },
  seedEntities: SeedEntity[],
  seedClaims: SeedClaim[],
): Promise<WorldSeedReport> {
  const [doc] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.userId, userId), eq(documents.driveFileId, source.driveFileId)))
    .limit(1)

  const documentId = doc?.id ?? null

  const report: WorldSeedReport = {
    entitiesCreated: 0,
    entitiesExisting: 0,
    claimsCreated: 0,
    claimsExisting: 0,
    documentId,
  }

  const idByName = new Map<string, { id: string; type: string }>()

  for (const entity of seedEntities) {
    const normalized = normalizeName(entity.name)

    const [existing] = await db
      .select({ id: entities.id })
      .from(entities)
      .where(
        and(
          eq(entities.userId, userId),
          eq(entities.entityType, entity.type),
          eq(entities.normalizedName, normalized),
        ),
      )
      .limit(1)

    if (existing) {
      idByName.set(entity.name, { id: existing.id, type: entity.type })
      report.entitiesExisting++
      continue
    }

    const [created] = await db
      .insert(entities)
      .values({
        userId,
        entityType: entity.type,
        name: entity.name,
        normalizedName: normalized,
        nameVariants: entity.variants ?? [],
        canonicity: 'canon',
        createdBy: 'seed',
        ...(entity.summary !== undefined && { summary: entity.summary }),
        ...(documentId !== null && { sourceDocumentId: documentId }),
      })
      .returning({ id: entities.id })

    idByName.set(entity.name, { id: created!.id, type: entity.type })
    report.entitiesCreated++
  }

  for (const claim of seedClaims) {
    const subject = idByName.get(claim.subject)
    if (!subject) throw new Error(`Seed claim names an entity not in the entity list: ${claim.subject}`)

    const object = claim.object ? idByName.get(claim.object) : undefined
    if (claim.object && !object) {
      throw new Error(`Seed claim names an object not in the entity list: ${claim.object}`)
    }

    const [inserted] = await db
      .insert(claims)
      .values({
        userId,
        subjectId: subject.id,
        subjectType: subject.type,
        predicate: claim.predicate,
        ...(object && { objectId: object.id, objectType: object.type }),
        ...valueColumns(claim),
        ...(claim.startTime !== undefined && {
          startTime: claim.startTime,
          ...withOrder('startOrder', claim.startTime),
        }),
        ...(claim.endTime !== undefined && {
          endTime: claim.endTime,
          ...withOrder('endOrder', claim.endTime),
        }),
        canonicity: 'canon',
        createdBy: 'seed',
      })
      // The fingerprint index is what makes re-running this a no-op rather than
      // a duplicate. Nothing here needs updating on a second run.
      .onConflictDoNothing()
      .returning({ id: claims.id })

    if (!inserted) {
      report.claimsExisting++
      continue
    }
    report.claimsCreated++

    await db
      .insert(claimSources)
      .values({
        userId,
        claimId: inserted.id,
        documentId,
        documentName: source.name,
        quote: claim.quote,
        paragraphIndex: claim.paragraph,
      })
      .onConflictDoNothing()
  }

  return report
}

const VALUE_TYPES = new Map(deriveOntology().predicates.map((p) => [p.name, p.valueType]))

/**
 * Routes a seed value into the column its predicate declares — asking the
 * registry rather than guessing from the value's JavaScript type, so a date
 * cannot silently land in `value_string` and fail the signature foreign key.
 */
function valueColumns(claim: SeedClaim): Record<string, unknown> {
  if (claim.value === undefined) return {}

  const valueType = VALUE_TYPES.get(claim.predicate)
  if (!valueType) throw new Error(`Seed claim uses '${claim.predicate}', which is not an attribute`)

  switch (valueType) {
    case 'int':
      return { valueInt: Number(claim.value) }
    case 'float':
      return { valueFloat: Number(claim.value) }
    case 'date':
      return { valueTime: String(claim.value), ...withOrder('valueOrder', String(claim.value)) }
    default:
      return { valueString: String(claim.value) }
  }
}

/** An unreadable label keeps its text and loses only its ordering. */
function withOrder(column: 'startOrder' | 'endOrder' | 'valueOrder', label: string) {
  const order = ordinalFor(label)
  return order === null ? {} : { [column]: order }
}
