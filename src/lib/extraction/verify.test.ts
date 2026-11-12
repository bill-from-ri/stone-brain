import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { NeonDatabase } from 'drizzle-orm/neon-serverless'
import * as schema from '@/db/schema'
import { verificationTarget } from '@/lib/documents/status'
import { applyMigrations } from '@/test/catalog'
import { setVerified } from './verify'

let pg: PGlite
let db: NeonDatabase<typeof schema>
let userId: string

beforeAll(async () => {
  pg = new PGlite()
  await applyMigrations(pg)
  db = drizzle(pg, { schema }) as unknown as NeonDatabase<typeof schema>
}, 180_000)

beforeEach(async () => {
  await pg.exec('delete from documents; delete from users;')
  const users = await pg.query<{ id: string }>(
    `insert into users (google_sub, email) values ('sub-1', 'a@example.test') returning id`,
  )
  userId = users.rows[0]!.id
})

async function doc(status: string): Promise<string> {
  const rows = await pg.query<{ id: string }>(
    `insert into documents (user_id, drive_file_id, name, mime_type, raw, status)
     values ($1, gen_random_uuid()::text, 'Doc', 'application/vnd.google-apps.document', '{}', $2)
     returning id`,
    [userId, status],
  )
  return rows.rows[0]!.id
}

describe('setVerified', () => {
  it('verifies an extracted document, and takes it back', async () => {
    const id = await doc('extracted')
    expect(await setVerified(db, userId, id, true)).toEqual({ ok: true, status: 'verified' })
    expect(await setVerified(db, userId, id, false)).toEqual({ ok: true, status: 'extracted' })
  })

  it('is harmless twice', async () => {
    const id = await doc('verified')
    expect(await setVerified(db, userId, id, true)).toEqual({ ok: true, status: 'verified' })
  })

  it('refuses to verify a document nobody has extracted', async () => {
    const id = await doc('unread')
    expect(await setVerified(db, userId, id, true)).toEqual({ ok: false, reason: 'not_extracted' })
  })

  it('does not reach another user’s document', async () => {
    const id = await doc('extracted')
    const other = await pg.query<{ id: string }>(
      `insert into users (google_sub, email) values ('sub-2', 'b@example.test') returning id`,
    )
    expect(await setVerified(db, other.rows[0]!.id, id, true)).toEqual({
      ok: false,
      reason: 'not_found',
    })
  })
})

describe('verificationTarget', () => {
  it('offers each action only where it applies', () => {
    expect(verificationTarget('extracted', true)).toEqual({ from: 'extracted', to: 'verified' })
    expect(verificationTarget('verified', false)).toEqual({ from: 'verified', to: 'extracted' })
    expect(verificationTarget('unread', true)).toBeNull()
    expect(verificationTarget('verified', true)).toBeNull()
    expect(verificationTarget(null, false)).toBeNull()
  })
})
