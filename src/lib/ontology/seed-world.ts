import { and, eq, sql } from 'drizzle-orm'
import type { NeonDatabase } from 'drizzle-orm/neon-serverless'
import type * as schema from '@/db/schema'
import { claimSources, claims, documents, entities } from '@/db/schema'
import { ordinalFor } from './calendar'
import { materialiseInverse } from './inverse-write'
import { normalizeName } from './matcher'
import { deriveOntology } from './registry'

/**
 * Hand-authored world data, and the loader that writes it.
 *
 * These claims are **ground truth for scoring Phase 2B extraction**, which is
 * the whole reason they are written by hand. Generate them with a model and
 * the scoring compares a model to itself and always passes.
 *
 * Everything here is `created_by: 'seed'` and `canonicity: 'canon'` — read from
 * a real document by a human, unlike an extractor's output, which lands as
 * `draft`. Re-running is safe: entities match on `(user, type, normalized
 * name)` and claims on the generated `fingerprint`.
 *
 * Only the direction the document states is labelled here. The loader writes
 * each relationship's inverse too, cited by the same passage, so the seeded
 * graph obeys the same invariant as everything else (see `inverse.ts`) and
 * scoring can compare it against extraction output that does the same.
 */

type Db = NeonDatabase<typeof schema>

export type SeedEntity = {
  name: string
  type: string
  variants?: string[]
  summary?: string
}

type SeedClaimBase = {
  subject: string
  predicate: string
  /** Relationship claims. */
  object?: string
  /** Attribute claims — routed by the predicate's declared value type. */
  value?: string | number
  startTime?: string
  endTime?: string
}

/** A claim read from the seed's document, cited by quote and paragraph. */
export type SourcedSeedClaim = SeedClaimBase & {
  quote: string
  paragraph: number
  /** Why this is a reading rather than a quote. Recorded, not enforced. */
  inferred?: string
  handEntered?: undefined
}

/**
 * A claim a person asserted with no document behind it — typically a
 * cross-document link no single document states (Enuarak lies in Enua).
 * Written as `created_by: 'user'` with no `claim_sources` row, so it is part of
 * the world but never part of any document's ground truth.
 */
export type HandEnteredSeedClaim = SeedClaimBase & {
  /** Why it was entered by hand. Recorded, not stored. */
  handEntered: string
  quote?: undefined
  paragraph?: undefined
  inferred?: undefined
}

export type SeedClaim = SourcedSeedClaim | HandEnteredSeedClaim

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
  { name: 'Elduin', type: 'region', summary: 'An island at the centre of the Dragon’s Shroud; home to the Kaldian Empire, its largest nation.' },
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
  { name: 'Enua', type: 'region', variants: ['Nethros'], summary: 'A peninsula, known as Nethros before the Enu Conquests of the 3rd century.' },
  { name: 'Zada Mountains', type: 'region', summary: 'The western of Enua’s two parallel mountain ranges, draining meltwater into the Lagetan Basin.' },
  { name: 'Orosh Mountains', type: 'region', summary: 'The northeastern of Enua’s two parallel mountain ranges, draining meltwater into the Lagetan Basin.' },
  { name: 'Lagetan Basin', type: 'region', summary: 'A basin in Enua fed by meltwater from the Zada and Orosh Mountains; a breadbasket since long before the Doom.' },
  { name: 'Ipherian Sea', type: 'region', summary: 'A sea once united by the Ipherian Empire, splintered into successor states after the Doom; cosmopolitan, on key trade routes.' },
  { name: 'Ipheria', type: 'region', summary: 'A maritime trading sphere to the west of Kovnia.' },
  { name: 'Merovia', type: 'region', summary: 'A cosmopolitan eastern coast of the Ipherian Sea region.' },
  { name: 'Agyros', type: 'region', summary: 'A cosmopolitan eastern coast of the Ipherian Sea region, alongside Merovia.' },
  { name: 'Ephria', type: 'region', summary: 'The second and smaller of Nevlos’ continents.' },
  { name: 'Southern Ephria', type: 'region', summary: 'The historically isolated south of Ephria: tropical rainforest and savannah, largely undeveloped, and a refuge for some of Nevlos’ last great megafauna.' },
  { name: 'Kovnia', type: 'region', summary: 'A dry, rocky region whose people depend on trade, set between the Ipherian and Akali maritime trading spheres.' },
  { name: 'Akál', type: 'region', variants: ['Akali Archipelago'], summary: 'A large archipelago off the continent’s southeastern coast, home to seafaring peoples once united by Tavilaga.' },
  { name: 'Sea of Akál', type: 'region', summary: 'The sea at the southern edge of the Central Empire.' },
  { name: 'Yeosin Frontier', type: 'region', summary: 'A political march rather than a landform.' },
  { name: 'Central Plain', type: 'region', summary: 'A highly productive river basin at the heart of the Central Empire, historically one of the most densely populated places in the world.' },
  { name: 'Great Steppe', type: 'region', summary: 'A vast grassy plateau at the centre of the continent; long home to nomadic hunters and herders, now dotted with trading towns linking East and West.' },

  { name: 'Ipherian Empire', type: 'society', summary: 'The empire that once united the Ipherian Sea, and splintered into successor states after the Doom.' },
  { name: 'Tavilaga', type: 'society', summary: 'A mighty seafaring empire that once united the Akali Archipelago.' },
  { name: 'Central Empire', type: 'society', summary: 'A multi-cultural hegemony dominating the continent’s eastern seaboard, from the Yeosin Frontier to the Sea of Akál.' },

  { name: 'Syrath', type: 'character', summary: 'The dragon who, in its final moments, created the Dragon’s Shroud to trap Vaski. The Syrathist religions bear its name.' },
  { name: 'Vaski', type: 'character', summary: 'The last of the giants.' },

  {
    name: 'Doom',
    type: 'event',
    summary: 'The event the world dates itself from. Not described here beyond its use as an epoch.',
  },
  { name: 'Enu Conquests', type: 'event', summary: 'The 3rd-century conquests after which the peninsula of Nethros became Enua.' },

  {
    name: "Dragon's Shroud",
    type: 'artifact',
    summary:
      'A colossal circular wall of dense magical fog, created by Syrath in the dragon’s final ' +
      'moments with the intention of trapping Vaski within it.',
  },

  { name: 'Grain', type: 'commodity', summary: 'The staple crop of breadbaskets such as the Lagetan Basin and the Kaldian Vale.' },

  // Species. Syrath's and Vaski's kinds, once free-text attributes.
  { name: 'Dragon', type: 'species', summary: 'The kind of being Syrath was.' },
  { name: 'Giant', type: 'species', summary: 'The kind of being Vaski is, the last of them.' },
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
    'Centered on a highly productive river basin called the Central Plain',
  steppe:
    'At the center of the continent is a massive, grassy plateau known as the Great Steppe.',
} as const

export const SEED_CLAIMS: SeedClaim[] = [
  /* ¶3 — the Dragon's Shroud */
  { subject: "Dragon's Shroud", predicate: 'created_by', object: 'Syrath', quote: Q.shroud, paragraph: 3 },
  {
    subject: "Dragon's Shroud",
    predicate: 'located_in',
    object: 'Elduin',
    quote: Q.shroud,
    paragraph: 3,
    inferred: '"centered on" is approximated as containment; there is no spatial predicate for it',
  },
  { subject: 'Elduin', predicate: 'landform', value: 'island', quote: Q.shroud, paragraph: 3 },
  { subject: 'Syrath', predicate: 'of_species', object: 'Dragon', quote: Q.shroud, paragraph: 3 },
  {
    subject: 'Syrath',
    predicate: 'vital_status',
    value: 'dead',
    quote: Q.shroud,
    paragraph: 3,
    inferred: '"during the dragon’s final moments" implies but does not state death',
  },
  { subject: 'Vaski', predicate: 'of_species', object: 'Giant', quote: Q.shroud, paragraph: 3 },

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
    subject: 'Enu Conquests',
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
  /** Existing entities that had no summary and were given the seed's. */
  summariesFilled: number
  /** Claims as labelled — the reverse directions are counted below. */
  claimsCreated: number
  claimsExisting: number
  /** Inverses written this run that were not already in the graph. */
  inversesCreated: number
  /**
   * Citations written this run. Normally equals `claimsCreated`; it runs higher
   * when a claim already existed from another document and this one is added as
   * a second source for it.
   */
  sourcesCreated: number
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
 *
 * A fact stated in two documents is one claim with two `claim_sources` rows: if
 * a claim already exists — seeded from an earlier document — this document is
 * still recorded as a source for it, so its ground truth is complete.
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

  // A hand-seeded document is ground truth a person read and labelled, so it is
  // Verified by definition — the one place `verified` is set from code rather
  // than by a user click, and legitimately so (contrast the extraction path,
  // which may only ever reach `extracted`). Idempotent; skipped when the
  // document has not synced yet.
  if (documentId !== null) {
    await db.update(documents).set({ status: 'verified' }).where(eq(documents.id, documentId))
  }

  const report: WorldSeedReport = {
    entitiesCreated: 0,
    entitiesExisting: 0,
    summariesFilled: 0,
    claimsCreated: 0,
    claimsExisting: 0,
    inversesCreated: 0,
    sourcesCreated: 0,
    documentId,
  }

  const idByName = new Map<string, { id: string; type: string }>()

  for (const entity of seedEntities) {
    const normalized = normalizeName(entity.name)

    const [existing] = await db
      .select({ id: entities.id, summary: entities.summary })
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
      // Fill a missing summary, never replace one: a summary already there may
      // have been written or edited by hand, and the seed is not its owner.
      if (entity.summary !== undefined && existing.summary === null) {
        await db.update(entities).set({ summary: entity.summary }).where(eq(entities.id, existing.id))
        report.summariesFilled++
      }
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

    const values = {
      userId,
      subjectId: subject.id,
      subjectType: subject.type,
      predicate: claim.predicate,
      objectId: object?.id ?? null,
      objectType: object?.type ?? null,
      ...valueColumns(claim),
      ...(claim.startTime !== undefined && {
        startTime: claim.startTime,
        ...withOrder('startOrder', claim.startTime),
      }),
      ...(claim.endTime !== undefined && {
        endTime: claim.endTime,
        ...withOrder('endOrder', claim.endTime),
      }),
      canonicity: 'canon' as const,
      createdBy: claim.handEntered === undefined ? ('seed' as const) : ('user' as const),
    }

    const [written] = await db
      .insert(claims)
      .values(values)
      // The fingerprint index is what makes re-running this a no-op rather than
      // a duplicate. The conflict action is a DO UPDATE that changes nothing, as
      // in `extraction-write.ts`, because DO NOTHING returns no id — and an
      // existing claim still needs this document's citation.
      .onConflictDoUpdate({
        target: [claims.userId, claims.fingerprint],
        set: { subjectId: sql`excluded.subject_id` },
      })
      .returning({ id: claims.id, inserted: sql<boolean>`(xmax = 0)` })

    if (written!.inserted) report.claimsCreated++
    else report.claimsExisting++

    if (claim.handEntered === undefined) {
      const [cited] = await db
        .insert(claimSources)
        .values({
          userId,
          claimId: written!.id,
          documentId,
          documentName: source.name,
          quote: claim.quote,
          paragraphIndex: claim.paragraph,
        })
        .onConflictDoNothing()
        .returning({ id: claimSources.id })

      if (cited) report.sourcesCreated++
    }

    // After the citation, so the inverse is cited by it too. A hand-entered
    // claim has none to copy, and its inverse is hand-entered alike.
    const inverse = await materialiseInverse(db, { ...values, id: written!.id })
    if (inverse?.inserted) report.inversesCreated++
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
