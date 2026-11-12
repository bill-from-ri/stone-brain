import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { NeonDatabase } from 'drizzle-orm/neon-serverless'
import * as schema from '@/db/schema'
import { inversePredicate } from '@/lib/ontology/inverse'
import { applyMigrations, seedCatalog } from '@/test/catalog'
import { RECAST, mergeEntities, planMerge } from './merge'

/**
 * The merge against a real Postgres running the real migrations. What is
 * under test is mostly what the catalog will accept — the composite entity
 * keys, the signature foreign key, the fingerprint index — so only a real one
 * can say whether a merge's writes go through.
 */

let pg: PGlite
let db: NeonDatabase<typeof schema>
let userId: string
let otherUserId: string
let docId: string

beforeAll(async () => {
  pg = new PGlite()
  await applyMigrations(pg)
  await seedCatalog(pg)
  db = drizzle(pg, { schema }) as unknown as NeonDatabase<typeof schema>
}, 180_000)

beforeEach(async () => {
  await pg.exec('delete from claim_sources; delete from claims; delete from entities;')
  await pg.exec('delete from documents; delete from users;')
  userId = await user('sub-1')
  otherUserId = await user('sub-2')
  const { rows } = await pg.query<{ id: string }>(
    `insert into documents (user_id, drive_file_id, name, mime_type, raw)
     values ($1, 'drive-1', 'Gazetteer', 'application/vnd.google-apps.document', '{}') returning id`,
    [userId],
  )
  docId = rows[0]!.id
})

async function user(sub: string) {
  const { rows } = await pg.query<{ id: string }>(
    `insert into users (google_sub, email) values ($1, $1 || '@example.test') returning id`,
    [sub],
  )
  return rows[0]!.id
}

type EntitySpec = { variants?: string[]; summary?: string; owner?: string; canon?: boolean }

async function entity(name: string, type: string, spec: EntitySpec = {}) {
  const { rows } = await pg.query<{ id: string }>(
    `insert into entities (user_id, entity_type, name, normalized_name, name_variants, summary, canonicity)
     values ($1, $2, $3, lower($3), $4, $5, $6) returning id`,
    [
      spec.owner ?? userId,
      type,
      name,
      JSON.stringify(spec.variants ?? []),
      spec.summary ?? null,
      spec.canon ? 'canon' : 'draft',
    ],
  )
  return rows[0]!.id
}

type End = { id: string; type: string }

async function claim(s: End, predicate: string, o: End | null, value?: string) {
  const { rows } = await pg.query<{ id: string }>(
    `insert into claims (user_id, subject_id, subject_type, predicate, object_id, object_type, value_string, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,'llm') returning id`,
    [userId, s.id, s.type, predicate, o?.id ?? null, o?.type ?? null, value ?? null],
  )
  return rows[0]!.id
}

/** A relationship and its materialised inverse. */
async function both(s: End, predicate: string, o: End) {
  return [await claim(s, predicate, o), await claim(o, inversePredicate(predicate)!, s)] as const
}

async function cite(claimId: string, paragraph: number, quote: string, revision = 'rev-1') {
  await pg.query(
    `insert into claim_sources (user_id, claim_id, document_id, document_name, quote, paragraph_index,
       document_revision_id, created_at)
     values ($1, $2, $3, 'Gazetteer (snapshot)', $4, $5, $6, '2026-01-02T03:04:05Z')`,
    [userId, claimId, docId, quote, paragraph, revision],
  )
}

async function claimsOf(id: string) {
  const { rows } = await pg.query<{ id: string; subject_id: string; predicate: string; object_id: string | null }>(
    `select id, subject_id, predicate, object_id from claims where subject_id = $1 or object_id = $1 order by predicate`,
    [id],
  )
  return rows
}

async function exists(id: string) {
  const { rows } = await pg.query(`select 1 from entities where id = $1`, [id])
  return rows.length > 0
}

const end = (id: string, type: string): End => ({ id, type })

describe('a same-type merge', () => {
  it('repoints claims at both ends, moving id and type together', async () => {
    const giant = end(await entity('Giant', 'species'), 'species')
    const giants = end(await entity('giants', 'species', { variants: ['the giants'] }), 'species')
    const north = end(await entity('Northern Wastes', 'region'), 'region')
    const [habitat, inverse] = await both(giants, 'located_in', north)

    const plan = await mergeEntities(db, userId, giant.id, giants.id)
    expect(plan).toMatchObject({ repointed: 2, folded: 0, recast: [], blockers: [] })
    expect(await exists(giants.id)).toBe(false)

    const after = await claimsOf(giant.id)
    expect(after.map((c) => c.id).sort()).toEqual([habitat, inverse].sort())
    expect(after.find((c) => c.id === habitat)).toMatchObject({ subject_id: giant.id, object_id: north.id })
    expect(after.find((c) => c.id === inverse)).toMatchObject({ subject_id: north.id, object_id: giant.id })
  })

  it('folds a twin into the claim the survivor has, keeping every citation column', async () => {
    const interior = end(await entity('Interior', 'region'), 'region')
    const basin = end(await entity('Interior Basin', 'region'), 'region')
    const gabelford = end(await entity('Gabelford', 'settlement'), 'settlement')
    const [kept] = await both(gabelford, 'located_in', interior)
    const [twin, twinInverse] = await both(gabelford, 'located_in', basin)
    await cite(kept!, 1, 'Gabelford, in the Interior')
    await cite(twin, 1, 'duplicate anchor — the index keeps the first')
    await cite(twin, 7, 'Gabelford lies in the Interior Basin', 'rev-9')

    const plan = await mergeEntities(db, userId, interior.id, basin.id)
    expect(plan).toMatchObject({ repointed: 0, folded: 2, blockers: [] })

    const { rows: gone } = await pg.query(`select 1 from claims where id = any($1)`, [[twin, twinInverse]])
    expect(gone).toEqual([])

    const { rows: sources } = await pg.query(
      `select document_id, document_name, quote, paragraph_index, document_revision_id, created_at
       from claim_sources where claim_id = $1 order by paragraph_index`,
      [kept],
    )
    expect(sources).toEqual([
      expect.objectContaining({ paragraph_index: 1, quote: 'Gabelford, in the Interior' }),
      {
        document_id: docId,
        document_name: 'Gazetteer (snapshot)',
        quote: 'Gabelford lies in the Interior Basin',
        paragraph_index: 7,
        document_revision_id: 'rev-9',
        created_at: new Date('2026-01-02T03:04:05Z'),
      },
    ])
  })

  it('adds the dropped name and its variants, and takes a summary only when the survivor has none', async () => {
    const aldo = await entity('Aldo Demard', 'character', { variants: ['Aldo'] })
    const count = await entity('Count Aldo Demard', 'character', {
      variants: ['the Count', 'aldo'],
      summary: 'Lord of Innenbeck.',
    })
    const plan = await mergeEntities(db, userId, aldo, count)
    expect(plan!.variantsAdded).toEqual(['Count Aldo Demard', 'the Count'])

    const { rows } = await pg.query<{ name_variants: string[]; summary: string | null }>(
      `select name_variants, summary from entities where id = $1`,
      [aldo],
    )
    expect(rows[0]).toEqual({
      name_variants: ['Aldo', 'Count Aldo Demard', 'the Count'],
      summary: 'Lord of Innenbeck.',
    })
  })

  it('keeps canon when the canon entity is the one dropped', async () => {
    const draft = await entity('Giant', 'species')
    const canon = await entity('giants', 'species', { canon: true })
    await mergeEntities(db, userId, draft, canon)

    const { rows } = await pg.query<{ canonicity: string }>(`select canonicity from entities where id = $1`, [draft])
    expect(rows[0]!.canonicity).toBe('canon')
  })
})

describe('a cross-type merge', () => {
  it('recasts located in / contains to member of / has member, both directions together', async () => {
    const society = end(await entity('Province of Innenbeck', 'society'), 'society')
    const region = end(await entity('Innenbeck Province', 'region'), 'region')
    const gabelford = end(await entity('Gabelford', 'settlement'), 'settlement')
    const kaldia = end(await entity('Kaldia', 'region'), 'region')
    const [locatedIn, contains] = await both(gabelford, 'located_in', region)
    // Fits a society as it stands: `society located_in region`.
    const [within] = await both(region, 'located_in', kaldia)

    const preview = await planMerge(db, userId, society.id, region.id)
    expect(preview!.blockers).toEqual([])
    expect(preview!.repointed).toBe(2)
    expect(preview!.recast.map((r) => [r.claimId, r.from, r.to]).sort()).toEqual(
      [
        [locatedIn, 'located_in', 'member_of'],
        [contains, 'contains', 'has_member'],
      ].sort(),
    )
    expect(preview!.recast.find((r) => r.claimId === locatedIn)!.sentence).toBe(
      'Gabelford located in Innenbeck Province',
    )
    // A preview writes nothing.
    expect(await exists(region.id)).toBe(true)

    const done = await mergeEntities(db, userId, society.id, region.id)
    expect(done).toEqual(preview)
    const after = await claimsOf(society.id)
    expect(after.map((c) => c.predicate).sort()).toEqual(['contains', 'has_member', 'located_in', 'member_of'])
    expect(after.find((c) => c.id === locatedIn)).toMatchObject({ predicate: 'member_of', object_id: society.id })
    expect(after.find((c) => c.id === contains)).toMatchObject({ predicate: 'has_member', subject_id: society.id })
    expect(after.find((c) => c.id === within)).toMatchObject({ predicate: 'located_in', subject_id: society.id })
  })

  it('blocks on a claim no recast fits, and writes nothing', async () => {
    const society = end(await entity('Province of Innenbeck', 'society'), 'society')
    const region = end(await entity('Innenbeck Province', 'region'), 'region')
    const vale = end(await entity('Lower Vale', 'region'), 'region')
    const gabelford = end(await entity('Gabelford', 'settlement'), 'settlement')
    const [valeIn] = await both(vale, 'located_in', region)
    await both(gabelford, 'located_in', region)

    const plan = await mergeEntities(db, userId, society.id, region.id)
    expect(plan!.blockers.map((b) => b.claimId)).toContain(valeIn)
    expect(plan!.blockers.find((b) => b.claimId === valeIn)).toEqual({
      claimId: valeIn,
      sentence: 'Lower Vale located in Innenbeck Province',
      reason: '“located in” does not connect a region to a society.',
    })

    expect(await exists(region.id)).toBe(true)
    const { rows } = await pg.query(`select predicate from claims where object_id = $1 order by predicate`, [region.id])
    expect(rows).toEqual([{ predicate: 'located_in' }, { predicate: 'located_in' }])
  })
})

describe('what a merge refuses', () => {
  it('blocks on a claim between the two, which would point at itself', async () => {
    const society = end(await entity('Province of Innenbeck', 'society'), 'society')
    const region = end(await entity('Innenbeck Province', 'region'), 'region')
    await both(society, 'located_in', region)

    const plan = await mergeEntities(db, userId, society.id, region.id)
    expect(plan!.blockers).toHaveLength(2)
    expect(plan!.blockers[0]!.reason).toMatch(/connect Province of Innenbeck to itself/)
    expect(await exists(region.id)).toBe(true)
  })

  it("knows nothing of another user's entities, or of merging one into itself", async () => {
    const mine = await entity('Giant', 'species')
    const theirs = await entity('giants', 'species', { owner: otherUserId })
    expect(await planMerge(db, userId, mine, theirs)).toBeNull()
    expect(await mergeEntities(db, userId, mine, theirs)).toBeNull()
    expect(await planMerge(db, userId, mine, mine)).toBeNull()
    expect(await exists(theirs)).toBe(true)
  })
})

describe('the four merges made by hand', () => {
  it('replays each', async () => {
    const north = end(await entity('North', 'region'), 'region')
    const cases: [string, string, string, string][] = [
      ['Giant', 'species', 'giants', 'species'],
      ['Interior', 'region', 'Interior Basin', 'region'],
      ['Aldo Demard', 'character', 'Count Aldo Demard', 'character'],
      ['Province of Innenbeck', 'society', 'Innenbeck Province', 'region'],
    ]
    for (const [keepName, keepType, dropName, dropType] of cases) {
      const keep = await entity(keepName, keepType)
      const drop = end(await entity(dropName, dropType), dropType)
      if (dropType === 'character') await claim(drop, 'born_in', north)
      else if (dropType === 'species' || dropType === 'region') await both(drop, 'located_in', north)

      const plan = await mergeEntities(db, userId, keep, drop.id)
      expect(plan!.blockers, dropName).toEqual([])
      expect(plan!.variantsAdded).toEqual([dropName])
      expect(await exists(drop.id)).toBe(false)
      expect((await claimsOf(drop.id)).length).toBe(0)
    }
  })
})

describe('RECAST', () => {
  it('recasts a relationship and its reverse direction consistently', () => {
    for (const [from, to] of Object.entries(RECAST)) {
      expect(RECAST[inversePredicate(from)!], from).toBe(inversePredicate(to))
    }
  })
})
