import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NeonDatabase } from 'drizzle-orm/neon-serverless'
import * as schema from '@/db/schema'
import { applyMigrations, seedCatalog } from '@/test/catalog'

/**
 * The hand-entry write path against a real Postgres, for the reasons given in
 * `extraction-write.test.ts`. What is under test is the pairing of a claim with
 * its inverse across create, edit and delete — and the pairing is found by
 * fingerprint columns and enforced by a unique index, which only a real
 * catalog can answer for.
 *
 * `claim-writes.ts` binds to the app's Neon-backed `db`, whose public API
 * other modules call with exactly `(userId, …)`. Rather than thread a handle
 * through that contract, the module is pointed at PGlite here. The getter
 * matters: the database is created in `beforeAll`, after this mock is hoisted.
 */

let testDb: NeonDatabase<typeof schema>
vi.mock('@/db', () => ({
  get db() {
    return testDb
  },
}))

const { createClaim, deleteClaim, updateClaim } = await import('./claim-writes')

let pg: PGlite
let userId: string
let documentId: string
const ids: Record<string, string> = {}

beforeAll(async () => {
  pg = new PGlite()
  await applyMigrations(pg)
  await seedCatalog(pg)
  testDb = drizzle(pg, { schema }) as unknown as NeonDatabase<typeof schema>
}, 180_000)

beforeEach(async () => {
  await pg.exec('delete from claim_sources; delete from claims; delete from entities;')
  await pg.exec('delete from documents; delete from users;')

  const users = await pg.query<{ id: string }>(
    `insert into users (google_sub, email) values ('sub-1', 'a@example.test') returning id`,
  )
  userId = users.rows[0]!.id

  const docs = await pg.query<{ id: string }>(
    `insert into documents (user_id, drive_file_id, name, mime_type, raw)
     values ($1, 'drive-1', 'Town of Gabelford', 'application/vnd.google-apps.document', '{}')
     returning id`,
    [userId],
  )
  documentId = docs.rows[0]!.id

  for (const [name, type] of [
    ['Sera Vane', 'character'],
    ['Tomas Ord', 'character'],
    ['Ashfall', 'settlement'],
    ['Gabelford', 'settlement'],
  ] as const) {
    const row = await pg.query<{ id: string }>(
      `insert into entities (user_id, entity_type, name, normalized_name, canonicity, created_by)
       values ($1, $2, $3, lower($3), 'canon', 'user') returning id`,
      [userId, type, name],
    )
    ids[name] = row.rows[0]!.id
  }
})

async function claimRows() {
  return testDb.select().from(schema.claims).where(eq(schema.claims.userId, userId))
}
async function sourceRows() {
  return testDb.select().from(schema.claimSources).where(eq(schema.claimSources.userId, userId))
}

const seraRulesAshfall = (over: Record<string, unknown> = {}) => ({
  subjectId: ids['Sera Vane']!,
  predicate: 'rules',
  objectId: ids['Ashfall']!,
  ...over,
})

describe('createClaim', () => {
  it('always writes the inverse, with the same dates', async () => {
    const result = await createClaim(
      userId,
      seraRulesAshfall({ startTime: '400 AD', endTime: '412 AD' }),
    )
    if (!result.ok) throw new Error(result.error)
    expect(result.inverseClaimId).not.toBeNull()

    const inverse = (await claimRows()).find((r) => r.id === result.inverseClaimId)
    expect(inverse).toMatchObject({
      subjectId: ids['Ashfall'],
      predicate: 'ruled_by',
      objectId: ids['Sera Vane'],
      startTime: '400 AD',
      endTime: '412 AD',
      canonicity: 'canon',
      createdBy: 'user',
    })
  })

  it('writes no inverse for an attribute', async () => {
    const result = await createClaim(userId, {
      subjectId: ids['Ashfall']!,
      predicate: 'population',
      value: '1800',
    })
    expect(result).toMatchObject({ ok: true, inverseClaimId: null })
    expect(await claimRows()).toHaveLength(1)
  })

  it('refuses a duplicate, including one stated from the other end', async () => {
    await createClaim(userId, seraRulesAshfall())

    expect(await createClaim(userId, seraRulesAshfall())).toMatchObject({ ok: false })
    // "Ashfall is ruled by Sera" is already there — it is the inverse.
    expect(
      await createClaim(userId, {
        subjectId: ids['Ashfall']!,
        predicate: 'ruled_by',
        objectId: ids['Sera Vane']!,
      }),
    ).toMatchObject({ ok: false, error: 'That claim already exists.' })
    expect(await claimRows()).toHaveLength(2)
  })

  it('refuses an end date before its start date as a sentence', async () => {
    const result = await createClaim(
      userId,
      seraRulesAshfall({ startTime: '412 AD', endTime: '400 AD' }),
    )
    expect(result).toMatchObject({ ok: false })
    expect(await claimRows()).toHaveLength(0)
  })
})

describe('deleteClaim', () => {
  it('removes the claim and its inverse', async () => {
    const created = await createClaim(userId, seraRulesAshfall())
    if (!created.ok) throw new Error(created.error)

    expect(await deleteClaim(userId, created.claimId)).toEqual({ deleted: 2 })
    expect(await claimRows()).toHaveLength(0)
  })

  it('works from either end', async () => {
    const created = await createClaim(userId, seraRulesAshfall())
    if (!created.ok) throw new Error(created.error)

    expect(await deleteClaim(userId, created.inverseClaimId!)).toEqual({ deleted: 2 })
    expect(await claimRows()).toHaveLength(0)
  })

  it('leaves the same two entities’ claim at another time alone', async () => {
    await createClaim(userId, seraRulesAshfall({ startTime: '400 AD', endTime: '412 AD' }))
    const later = await createClaim(userId, seraRulesAshfall({ startTime: '430 AD' }))
    if (!later.ok) throw new Error(later.error)

    expect(await deleteClaim(userId, later.claimId)).toEqual({ deleted: 2 })
    const rows = await claimRows()
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.startTime === '400 AD')).toBe(true)
  })

  it('deletes nothing for another user’s claim', async () => {
    const created = await createClaim(userId, seraRulesAshfall())
    if (!created.ok) throw new Error(created.error)

    const other = await pg.query<{ id: string }>(
      `insert into users (google_sub, email) values ('sub-2', 'b@example.test') returning id`,
    )
    expect(await deleteClaim(other.rows[0]!.id, created.claimId)).toEqual({ deleted: 0 })
    expect(await claimRows()).toHaveLength(2)
  })
})

describe('updateClaim', () => {
  it('moves the inverse with a changed object, in place', async () => {
    const created = await createClaim(userId, seraRulesAshfall())
    if (!created.ok) throw new Error(created.error)

    const result = await updateClaim(userId, created.claimId, { objectId: ids['Gabelford'] })
    expect(result).toEqual({
      ok: true,
      claimId: created.claimId,
      // The same row, so anything pinned to its id survives the edit.
      inverseClaimId: created.inverseClaimId,
    })

    const rows = await claimRows()
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.id === created.claimId)!.objectId).toBe(ids['Gabelford'])
    expect(rows.find((r) => r.id === created.inverseClaimId)).toMatchObject({
      subjectId: ids['Gabelford'],
      subjectType: 'settlement',
      predicate: 'ruled_by',
      objectId: ids['Sera Vane'],
    })
  })

  it('sets and clears dates on both directions', async () => {
    const created = await createClaim(userId, seraRulesAshfall({ endTime: '412 AD' }))
    if (!created.ok) throw new Error(created.error)

    await updateClaim(userId, created.claimId, { startTime: '400 AD', endTime: null })

    for (const row of await claimRows()) {
      expect(row.startTime, row.predicate).toBe('400 AD')
      expect(row.startOrder, row.predicate).not.toBeNull()
      expect(row.endTime, row.predicate).toBeNull()
      expect(row.endOrder, row.predicate).toBeNull()
    }
  })

  it('changes an attribute’s value and recomputes its sort key', async () => {
    const created = await createClaim(userId, {
      subjectId: ids['Ashfall']!,
      predicate: 'founded_on',
      value: '400 AD',
    })
    if (!created.ok) throw new Error(created.error)

    const result = await updateClaim(userId, created.claimId, { value: '380 AD' })
    expect(result).toMatchObject({ ok: true, inverseClaimId: null })

    const [row] = await claimRows()
    expect(row!.valueTime).toBe('380 AD')
    expect(row!.valueOrder).toBeLessThan(400)
  })

  it('validates like createClaim', async () => {
    const created = await createClaim(userId, seraRulesAshfall())
    if (!created.ok) throw new Error(created.error)

    // A character is not something one rules.
    const result = await updateClaim(userId, created.claimId, { objectId: ids['Tomas Ord'] })
    expect(result).toMatchObject({ ok: false })
    expect((await claimRows()).find((r) => r.id === created.claimId)!.objectId).toBe(ids['Ashfall'])

    expect(await updateClaim(userId, created.claimId, { value: 'x' })).toMatchObject({ ok: false })
  })

  it('refuses an edit that collides with an existing claim, and writes nothing', async () => {
    await createClaim(userId, seraRulesAshfall({ startTime: '400 AD' }))
    const other = await createClaim(userId, seraRulesAshfall({ startTime: '430 AD' }))
    if (!other.ok) throw new Error(other.error)

    const result = await updateClaim(userId, other.claimId, { startTime: '400 AD' })
    expect(result).toEqual({ ok: false, error: 'An identical claim already exists.' })

    const starts = (await claimRows()).map((r) => r.startTime).sort()
    expect(starts).toEqual(['400 AD', '400 AD', '430 AD', '430 AD'])
  })

  it('adopts an existing claim the edited inverse now equals', async () => {
    const created = await createClaim(userId, seraRulesAshfall())
    if (!created.ok) throw new Error(created.error)
    // A one-directional row from before the invariant, saying what the edited
    // inverse is about to.
    const lone = await pg.query<{ id: string }>(
      `insert into claims (user_id, subject_id, subject_type, predicate, object_id, object_type,
                           canonicity, created_by)
       values ($1, $2, 'settlement', 'ruled_by', $3, 'character', 'canon', 'user') returning id`,
      [userId, ids['Gabelford'], ids['Sera Vane']],
    )

    const result = await updateClaim(userId, created.claimId, { objectId: ids['Gabelford'] })
    expect(result).toEqual({ ok: true, claimId: created.claimId, inverseClaimId: lone.rows[0]!.id })
    // The old inverse is retired rather than left asserting the pre-edit fact.
    expect(await claimRows()).toHaveLength(2)
  })

  it('writes the missing inverse of a claim older than the invariant', async () => {
    const lone = await pg.query<{ id: string }>(
      `insert into claims (user_id, subject_id, subject_type, predicate, object_id, object_type,
                           canonicity, created_by)
       values ($1, $2, 'character', 'rules', $3, 'settlement', 'canon', 'user') returning id`,
      [userId, ids['Sera Vane'], ids['Ashfall']],
    )

    const result = await updateClaim(userId, lone.rows[0]!.id, { startTime: '400 AD' })
    if (!result.ok) throw new Error(result.error)
    expect(result.inverseClaimId).not.toBeNull()
    expect(await claimRows()).toHaveLength(2)
  })

  it('keeps an extracted claim’s sources and provenance, and mirrors them', async () => {
    const claim = await pg.query<{ id: string }>(
      `insert into claims (user_id, subject_id, subject_type, predicate, object_id, object_type,
                           canonicity, created_by, extracted_by_model)
       values ($1, $2, 'character', 'rules', $3, 'settlement', 'draft', 'llm', 'test/model')
       returning id`,
      [userId, ids['Sera Vane'], ids['Ashfall']],
    )
    const claimId = claim.rows[0]!.id
    await pg.query(
      `insert into claim_sources (user_id, claim_id, document_id, document_name, quote, paragraph_index)
       values ($1, $2, $3, 'Town of Gabelford', 'Sera Vane rules Ashfall.', 4)`,
      [userId, claimId, documentId],
    )

    const result = await updateClaim(userId, claimId, { startTime: '400 AD' })
    if (!result.ok) throw new Error(result.error)

    const rows = await claimRows()
    expect(rows.find((r) => r.id === claimId)).toMatchObject({
      startTime: '400 AD',
      canonicity: 'draft',
      createdBy: 'llm',
      extractedByModel: 'test/model',
    })

    const sources = await sourceRows()
    expect(sources.filter((s) => s.claimId === claimId)).toHaveLength(1)
    // The inverse written for it is evidenced by the same passage.
    expect(sources.find((s) => s.claimId === result.inverseClaimId)).toMatchObject({
      quote: 'Sera Vane rules Ashfall.',
      paragraphIndex: 4,
    })
  })

  it('reports a claim that is not there', async () => {
    expect(
      await updateClaim(userId, '00000000-0000-4000-8000-000000000000', { startTime: null }),
    ).toMatchObject({ ok: false })
  })
})
