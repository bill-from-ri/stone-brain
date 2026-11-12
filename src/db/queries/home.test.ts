import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentStatus } from '@/db/schema'
import { applyMigrations } from '@/test/catalog'

/**
 * Home's queries against a real Postgres. What matters here is SQL semantics —
 * `count(*) filter`, a `>` between two nullable bigints, `nulls last` — and the
 * user scope on every table read, so a mocked query builder would prove
 * nothing.
 *
 * The queries import the app's `db` singleton, which binds to Neon. It is
 * swapped for a PGlite-backed one here; the queries themselves run unchanged.
 */

const pg = new PGlite()

vi.mock('@/db', async () => {
  const { drizzle } = await import('drizzle-orm/pglite')
  const schemaModule = await import('@/db/schema')
  return { db: drizzle(pg, { schema: schemaModule }) }
})

const { countClaims, getAttentionDocuments, getDocumentMix, getRecentRuns } = await import('./home')

let me: string
let other: string

beforeAll(async () => {
  await applyMigrations(pg)
}, 180_000)

beforeEach(async () => {
  await pg.exec('delete from extraction_runs; delete from documents; delete from folders;')
  await pg.exec('delete from users;')
  me = await user('me')
  other = await user('other')
})

async function user(sub: string): Promise<string> {
  const { rows } = await pg.query<{ id: string }>(
    `insert into users (google_sub, email) values ($1, $1 || '@example.test') returning id`,
    [sub],
  )
  return rows[0]!.id
}

type DocOver = {
  status?: DocumentStatus
  driveVersion?: number | null
  extractedDriveVersion?: number | null
  removed?: boolean
  modified?: string | null
  parent?: string
}

async function document(userId: string, name: string, over: DocOver = {}): Promise<string> {
  const { rows } = await pg.query<{ id: string }>(
    `insert into documents
       (user_id, drive_file_id, parent_drive_folder_id, name, mime_type, raw,
        status, drive_version, extracted_drive_version, removed_at, modified_time)
     values ($1, $2, $3, $4, 'application/vnd.google-apps.document', '{}',
             $5, $6, $7, $8, $9)
     returning id`,
    [
      userId,
      `drive-${name}`,
      over.parent ?? 'folder-1',
      name,
      over.status ?? 'unread',
      over.driveVersion === undefined ? 10 : over.driveVersion,
      over.extractedDriveVersion ?? null,
      over.removed ? new Date() : null,
      over.modified === undefined ? null : over.modified,
    ],
  )
  return rows[0]!.id
}

describe('getDocumentMix', () => {
  it('buckets the library by extraction state', async () => {
    await document(me, 'never')
    await document(me, 'current', { status: 'extracted', extractedDriveVersion: 10 })
    await document(me, 'changed', { status: 'extracted', driveVersion: 14, extractedDriveVersion: 10 })
    await document(me, 'verified', { status: 'verified', extractedDriveVersion: 10 })
    await document(me, 'gone', { removed: true })
    await document(other, 'theirs')

    expect(await getDocumentMix(me)).toEqual({
      total: 4,
      verified: 1,
      extracted: 3,
      notExtracted: 1,
      changedSinceExtraction: 1,
    })
  })

  it('does not call a document with no known drive version changed', async () => {
    await document(me, 'unknown', { status: 'extracted', driveVersion: null, extractedDriveVersion: 3 })
    expect((await getDocumentMix(me)).changedSinceExtraction).toBe(0)
  })
})

describe('getAttentionDocuments', () => {
  it('returns each reason once per document, newest edit first, scoped to the user', async () => {
    await pg.query(
      `insert into folders (user_id, drive_folder_id, name, raw) values ($1, 'folder-1', 'History', '{}')`,
      [me],
    )
    await document(me, 'old', { modified: '2026-01-01T00:00:00Z' })
    await document(me, 'new', { modified: '2026-06-01T00:00:00Z' })
    await document(me, 'undated')
    await document(me, 'changed', { status: 'extracted', driveVersion: 12, extractedDriveVersion: 10 })
    // Changed AND unverified: reported once, as changed.
    await document(me, 'awaiting', { status: 'extracted', extractedDriveVersion: 10 })
    await document(me, 'verified', { status: 'verified', extractedDriveVersion: 10 })
    await document(me, 'gone', { removed: true })
    await document(other, 'theirs')

    const rows = await getAttentionDocuments(me)
    expect(rows.map((r) => [r.reason, r.name])).toEqual([
      ['changed', 'changed'],
      ['not_extracted', 'new'],
      ['not_extracted', 'old'],
      ['not_extracted', 'undated'],
      ['unverified', 'awaiting'],
    ])
    expect(rows[0]?.folderName).toBe('History')
  })

  it('limits each reason separately', async () => {
    for (const n of ['a', 'b', 'c']) await document(me, n)
    await document(me, 'awaiting', { status: 'extracted', extractedDriveVersion: 10 })

    const rows = await getAttentionDocuments(me, 2)
    expect(rows.map((r) => r.reason)).toEqual(['not_extracted', 'not_extracted', 'unverified'])
  })
})

describe('getRecentRuns', () => {
  it('lists the user’s runs newest first, flagging removed documents', async () => {
    const kept = await document(me, 'kept')
    const gone = await document(me, 'gone', { removed: true })
    const theirs = await document(other, 'theirs')

    await pg.query(
      `insert into extraction_runs (user_id, document_id, status, claims_created, started_at)
       values ($1, $2, 'succeeded', 7, '2026-11-01T00:00:00Z'),
              ($1, $3, 'failed', 0, '2026-11-02T00:00:00Z'),
              ($4, $5, 'succeeded', 1, '2026-11-03T00:00:00Z')`,
      [me, kept, gone, other, theirs],
    )

    const runs = await getRecentRuns(me)
    expect(runs.map((r) => [r.documentName, r.status, r.documentRemoved])).toEqual([
      ['gone', 'failed', true],
      ['kept', 'succeeded', false],
    ])
    expect(runs[1]?.claimsCreated).toBe(7)
  })
})

describe('countClaims', () => {
  it('is zero for a user with none', async () => {
    expect(await countClaims(me)).toBe(0)
  })
})
