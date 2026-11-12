import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import type { NeonDatabase } from 'drizzle-orm/neon-serverless'
import { describe, expect, it } from 'vitest'
import * as schema from '@/db/schema'
import { applyMigrations, seedCatalog } from '@/test/catalog'
import { NONE, deriveOntology } from './registry'
import { KALDIA_CLAIMS, KALDIA_ENTITIES } from './seed-kaldia'
import { RUNAR_CLAIMS, RUNAR_ENTITIES } from './seed-runar'
import {
  SEED_CLAIMS,
  SEED_DOCUMENT,
  SEED_ENTITIES,
  loadSeed,
  type SeedClaim,
  type SeedEntity,
} from './seed-world'

/**
 * The hand-seeded ground truth, checked against the registry it will be written
 * under.
 *
 * The database would reject an illegal signature too, but only at seed time and
 * one claim at a time, after the entities before it are already written. This
 * catches it before any of that, and pins the labelling conventions the
 * seed-ground-truth skill asks for so a later round cannot quietly drift.
 */

const SEEDS: [string, SeedEntity[], SeedClaim[]][] = [
  ['Written Map', SEED_ENTITIES, SEED_CLAIMS],
  ['The Kaldian Empire', KALDIA_ENTITIES, KALDIA_CLAIMS],
  ['The Runar', RUNAR_ENTITIES, RUNAR_CLAIMS],
]

const { predicates, signatures } = deriveOntology()
const predicateByName = new Map(predicates.map((p) => [p.name, p]))
const legal = new Set(signatures.map((s) => `${s.predicate}|${s.subjectType}|${s.objectType}|${s.valueKind}`))

/** Words a title-cased name may leave lower case. */
const MINOR_WORDS = new Set(['of', 'the', 'and', 'in', 'on', 'a', 'an'])

describe.each(SEEDS)('seed: %s', (_doc, seedEntities, seedClaims) => {
  const typeByName = new Map(seedEntities.map((e) => [e.name, e.type]))

  it('names every claim entity in its own entity list', () => {
    for (const claim of seedClaims) {
      expect(typeByName.has(claim.subject), `subject ${claim.subject}`).toBe(true)
      if (claim.object !== undefined) expect(typeByName.has(claim.object), `object ${claim.object}`).toBe(true)
    }
  })

  it('uses only signatures the registry declares', () => {
    for (const claim of seedClaims) {
      const predicate = predicateByName.get(claim.predicate)
      expect(predicate, `predicate ${claim.predicate}`).toBeDefined()
      const key =
        claim.object !== undefined
          ? `${claim.predicate}|${typeByName.get(claim.subject)}|${typeByName.get(claim.object)}|${NONE}`
          : `${claim.predicate}|${typeByName.get(claim.subject)}|${NONE}|${predicate!.valueType}`
      expect(legal.has(key), `${claim.subject} ${claim.predicate} ${claim.object ?? claim.value}`).toBe(true)
    }
  })

  it('keeps enum values inside their enum', () => {
    for (const claim of seedClaims) {
      const allowed = predicateByName.get(claim.predicate)?.valueEnum
      if (allowed) expect(allowed, `${claim.subject} ${claim.predicate}`).toContain(claim.value)
    }
  })

  it('dates only temporal predicates', () => {
    for (const claim of seedClaims.filter((c) => c.startTime !== undefined || c.endTime !== undefined)) {
      expect(predicateByName.get(claim.predicate)?.isTemporal, `${claim.subject} ${claim.predicate}`).toBe(true)
    }
  })

  it('names entities by the conventions: no leading "The", title case', () => {
    for (const { name } of seedEntities) {
      expect(name, name).not.toMatch(/^the\s/i)
      for (const word of name.split(/\s+/)) {
        if (!MINOR_WORDS.has(word)) expect(word[0], `${name}: "${word}"`).toBe(word[0]!.toUpperCase())
      }
    }
  })

  it('gives every entity it creates a summary', () => {
    // An entity reused from an earlier seed may omit it — the first seed owns it.
    const reused = new Set(SEEDS.filter(([, e]) => e !== seedEntities).flatMap(([, e]) => e.map((x) => x.name)))
    for (const entity of seedEntities) {
      if (!reused.has(entity.name)) expect(entity.summary, entity.name).toBeTruthy()
    }
  })
})

/**
 * The loader, against a real catalog: the labelled direction is all a seed
 * states, so the inverses are the loader's to write — cited, so the seeded
 * graph obeys the same invariant extraction does.
 */
describe('loadSeed', () => {
  it('materialises every relationship’s inverse with the same citation, idempotently', async () => {
    const pg = new PGlite()
    await applyMigrations(pg)
    await seedCatalog(pg)
    const db = drizzle(pg, { schema }) as unknown as NeonDatabase<typeof schema>

    const users = await pg.query<{ id: string }>(
      `insert into users (google_sub, email) values ('sub-1', 'a@example.test') returning id`,
    )
    const userId = users.rows[0]!.id
    await pg.query(
      `insert into documents (user_id, drive_file_id, name, mime_type, raw)
       values ($1, $2, $3, 'application/vnd.google-apps.document', '{}')`,
      [userId, SEED_DOCUMENT.driveFileId, SEED_DOCUMENT.name],
    )

    const relationships = SEED_CLAIMS.filter((c) => c.object !== undefined).length
    const first = await loadSeed(db, userId, SEED_DOCUMENT, SEED_ENTITIES, SEED_CLAIMS)

    expect(first.claimsCreated).toBe(SEED_CLAIMS.length)
    expect(first.inversesCreated).toBe(relationships)

    // Every relationship row has its reverse, and the two cite the same passages.
    const pairs = await pg.query<{ predicate: string; mine: string; theirs: string | null }>(`
      select c.predicate,
             (select string_agg(paragraph_index::text, ',' order by paragraph_index)
                from claim_sources where claim_id = c.id) as mine,
             (select string_agg(s.paragraph_index::text, ',' order by s.paragraph_index)
                from claims i join claim_sources s on s.claim_id = i.id
               where i.user_id = c.user_id and i.subject_id = c.object_id
                 and i.object_id = c.subject_id and i.predicate = p.inverse_name) as theirs
      from claims c join predicates p on p.name = c.predicate
      where c.object_id is not null
    `)
    expect(pairs.rows).toHaveLength(relationships * 2)
    for (const row of pairs.rows) expect(row.theirs, row.predicate).toBe(row.mine)

    const second = await loadSeed(db, userId, SEED_DOCUMENT, SEED_ENTITIES, SEED_CLAIMS)
    expect(second).toMatchObject({ claimsCreated: 0, inversesCreated: 0, sourcesCreated: 0 })

    await pg.close()
  }, 180_000)
})
