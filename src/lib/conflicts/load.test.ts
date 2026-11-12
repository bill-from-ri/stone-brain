import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { NeonDatabase } from 'drizzle-orm/neon-serverless'
import * as schema from '@/db/schema'
import { ordinalFor } from '@/lib/ontology/calendar'
import { applyMigrations, seedCatalog } from '@/test/catalog'
import {
  claimIdsOf,
  dismissConflict,
  documentIdsOf,
  loadConflicts,
  restoreConflict,
  type Conflict,
  type ValueConflict,
  type VanishedSourceConflict,
} from './load'

/**
 * The conflict queries against a real Postgres running the real migrations.
 * What is under test is mostly SQL — the candidate filters, the "every source
 * is gone" aggregate, the user scope — so a mocked database would only test
 * this file's idea of what those queries return.
 */

let pg: PGlite
let db: NeonDatabase<typeof schema>
let userId: string
let otherUserId: string
let doc: { live: string; gone: string; trashed: string }

beforeAll(async () => {
  pg = new PGlite()
  await applyMigrations(pg)
  await seedCatalog(pg)
  db = drizzle(pg, { schema }) as unknown as NeonDatabase<typeof schema>
}, 180_000)

beforeEach(async () => {
  await pg.exec('delete from conflict_dismissals; delete from claim_sources; delete from claims;')
  await pg.exec('delete from entities; delete from documents; delete from users;')

  userId = await user('sub-1')
  otherUserId = await user('sub-2')
  doc = {
    live: await document(userId, 'drive-live', 'Town of Gabelford'),
    gone: await document(userId, 'drive-gone', 'Old Chronicle', { removed: true }),
    trashed: await document(userId, 'drive-trash', 'Draft Notes', { trashed: true }),
  }
})

async function user(sub: string) {
  const { rows } = await pg.query<{ id: string }>(
    `insert into users (google_sub, email) values ($1, $1 || '@example.test') returning id`,
    [sub],
  )
  return rows[0]!.id
}

async function document(owner: string, driveId: string, name: string, state: { removed?: boolean; trashed?: boolean } = {}) {
  const { rows } = await pg.query<{ id: string }>(
    `insert into documents (user_id, drive_file_id, name, mime_type, raw, removed_at, trashed, web_view_link)
     values ($1, $2, $3, 'application/vnd.google-apps.document', '{}', $4, $5, 'https://docs.example/' || $2)
     returning id`,
    [owner, driveId, name, state.removed || state.trashed ? new Date() : null, state.trashed ?? false],
  )
  return rows[0]!.id
}

async function entity(name: string, type: string, owner = userId) {
  const { rows } = await pg.query<{ id: string }>(
    `insert into entities (user_id, entity_type, name, normalized_name) values ($1, $2, $3, lower($3)) returning id`,
    [owner, type, name],
  )
  return rows[0]!.id
}

type ClaimSpec = {
  subject: string
  subjectType: string
  predicate: string
  object?: string
  objectType?: string
  valueString?: string
  start?: string
  end?: string
  owner?: string
}

async function claim(spec: ClaimSpec): Promise<string> {
  const { rows } = await pg.query<{ id: string }>(
    `insert into claims (user_id, subject_id, subject_type, predicate, object_id, object_type,
       value_string, start_time, start_order, end_time, end_order, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'llm') returning id`,
    [
      spec.owner ?? userId, spec.subject, spec.subjectType, spec.predicate, spec.object ?? null,
      spec.objectType ?? null, spec.valueString ?? null, spec.start ?? null,
      spec.start ? ordinalFor(spec.start) : null, spec.end ?? null, spec.end ? ordinalFor(spec.end) : null,
    ],
  )
  return rows[0]!.id
}

async function cite(claimId: string, documentId: string | null, quote = 'q', paragraph = 1, owner = userId) {
  await pg.query(
    `insert into claim_sources (user_id, claim_id, document_id, document_name, quote, paragraph_index)
     values ($1, $2, $3, 'Snapshot name', $4, $5)`,
    [owner, claimId, documentId, quote, paragraph],
  )
}

/** A relationship and its materialised inverse, as every write path now stores it. */
async function both(forward: ClaimSpec, inversePredicate: string) {
  const a = await claim(forward)
  const b = await claim({
    ...forward,
    subject: forward.object!,
    subjectType: forward.objectType!,
    object: forward.subject,
    objectType: forward.subjectType,
    predicate: inversePredicate,
  })
  return [a, b] as const
}

const values = (all: Conflict[]) => all.filter((c): c is ValueConflict => c.kind === 'value')
const vanished = (all: Conflict[]) =>
  all.filter((c): c is VanishedSourceConflict => c.kind === 'vanished_source')

describe('value conflicts', () => {
  let ashfall: string
  let sera: string
  let orin: string

  beforeEach(async () => {
    ashfall = await entity('Ashfall', 'settlement')
    sera = await entity('Sera Vane', 'character')
    orin = await entity('Orin', 'character')
  })

  const rules = (ruler: string, start?: string, end?: string): ClaimSpec => ({
    subject: ruler, subjectType: 'character', predicate: 'rules', object: ashfall, objectType: 'settlement', start, end,
  })

  it('finds two rulers of one city through the single-valued direction only', async () => {
    const [seraRules, seraRuledBy] = await both(rules(sera), 'ruled_by')
    const [, orinRuledBy] = await both(rules(orin), 'ruled_by')
    await cite(seraRules, doc.live, 'Sera Vane rules Ashfall.', 4)
    await cite(seraRuledBy, doc.live, 'Sera Vane rules Ashfall.', 4)

    const found = values(await loadConflicts(db, userId))

    // One conflict, on `ruled_by` — `rules` is many-valued and raises nothing.
    expect(found).toHaveLength(1)
    const [conflict] = found
    expect(conflict!.predicate.name).toBe('ruled_by')
    expect(conflict!.subject).toEqual({ id: ashfall, name: 'Ashfall', type: 'settlement' })
    const bySide = new Map(conflict!.sides.map((s) => [s.claims[0]!.objectName, s]))
    expect([...bySide.keys()].sort()).toEqual(['Orin', 'Sera Vane'])
    expect(bySide.get('Sera Vane')!.displaces).toEqual([orinRuledBy])
    expect(conflict!.dismissed).toBe(false)

    const evidence = bySide.get('Sera Vane')!.claims[0]!.sources
    expect(evidence).toEqual([
      expect.objectContaining({
        documentId: doc.live,
        documentName: 'Town of Gabelford',
        quote: 'Sera Vane rules Ashfall.',
        paragraphIndex: 4,
        removed: false,
        webViewLink: 'https://docs.example/drive-live',
      }),
    ])
  })

  it('does not raise a dated succession', async () => {
    await both(rules(sera, 'AD 400', 'AD 412'), 'ruled_by')
    await both(rules(orin, 'AD 412', 'AD 430'), 'ruled_by')
    expect(values(await loadConflicts(db, userId))).toEqual([])
  })

  it('raises a disagreement over a single-valued attribute', async () => {
    await claim({ subject: sera, subjectType: 'character', predicate: 'vital_status', valueString: 'alive' })
    await claim({ subject: sera, subjectType: 'character', predicate: 'vital_status', valueString: 'dead' })
    const [conflict] = values(await loadConflicts(db, userId))
    expect(conflict!.sides.map((s) => s.claims[0]!.value).sort()).toEqual(['alive', 'dead'])
    expect(conflict!.predicate.valueEnum).toContain('alive')
  })

  it('ignores a many-valued attribute', async () => {
    await claim({ subject: sera, subjectType: 'character', predicate: 'title', valueString: 'Queen' })
    await claim({ subject: sera, subjectType: 'character', predicate: 'title', valueString: 'Warden' })
    expect(await loadConflicts(db, userId)).toEqual([])
  })

  it("never reads another user's claims", async () => {
    const theirs = await entity('Ashfall', 'settlement', otherUserId)
    const theirRuler = await entity('Vaski', 'character', otherUserId)
    await claim({ subject: theirs, subjectType: 'settlement', predicate: 'ruled_by', object: theirRuler, objectType: 'character', owner: otherUserId })
    await claim({ subject: ashfall, subjectType: 'settlement', predicate: 'ruled_by', object: sera, objectType: 'character' })
    expect(await loadConflicts(db, userId)).toEqual([])
    expect(await loadConflicts(db, otherUserId)).toEqual([])
  })

  it('dismisses, stays dismissed, re-opens on a new side, and restores', async () => {
    await both(rules(sera), 'ruled_by')
    await both(rules(orin), 'ruled_by')
    const [before] = values(await loadConflicts(db, userId))

    await dismissConflict(db, userId, 'value', before!.key)
    await dismissConflict(db, userId, 'value', before!.key)
    const [after] = values(await loadConflicts(db, userId))
    expect(after!.dismissed).toBe(true)

    // A third ruler the user has never seen re-opens it.
    const vaski = await entity('Vaski', 'character')
    await both(rules(vaski), 'ruled_by')
    const [reopened] = values(await loadConflicts(db, userId))
    expect(reopened!.sides).toHaveLength(3)
    expect(reopened!.dismissed).toBe(false)

    // Dismiss the three-way conflict, then restore it from the current read.
    await dismissConflict(db, userId, 'value', reopened!.key)
    await restoreConflict(db, userId, reopened!)
    const [restored] = values(await loadConflicts(db, userId))
    expect(restored!.dismissed).toBe(false)
    const { rows } = await pg.query(`select 1 from conflict_dismissals where kind = 'value' and key = $1`, [reopened!.key])
    expect(rows).toHaveLength(0)
  })

  it('reports every document a conflict cites', async () => {
    const [, seraRuledBy] = await both(rules(sera), 'ruled_by')
    const [, orinRuledBy] = await both(rules(orin), 'ruled_by')
    await cite(seraRuledBy, doc.live)
    await cite(orinRuledBy, doc.gone)
    const [conflict] = values(await loadConflicts(db, userId))
    expect(documentIdsOf(conflict!)).toEqual(new Set([doc.live, doc.gone]))
  })

  it('carries the reverse direction of each side, so both rows can be marked', async () => {
    const [seraRules, seraRuledBy] = await both(rules(sera), 'ruled_by')
    const [orinRules, orinRuledBy] = await both(rules(orin), 'ruled_by')
    // Same ends as Sera's side, but dated: a different assertion, not its mirror.
    await claim(rules(sera, 'AD 300', 'AD 310'))

    const [conflict, ...rest] = values(await loadConflicts(db, userId))
    expect(rest).toEqual([])
    expect(new Set(conflict!.mirrorIds)).toEqual(new Set([seraRules, orinRules]))
    expect(new Set(claimIdsOf(conflict!))).toEqual(
      new Set([seraRuledBy, orinRuledBy, seraRules, orinRules]),
    )
  })
})

describe('vanished sources', () => {
  let sera: string
  let ashfall: string

  beforeEach(async () => {
    sera = await entity('Sera Vane', 'character')
    ashfall = await entity('Ashfall', 'settlement')
  })

  const title = (value: string) =>
    claim({ subject: sera, subjectType: 'character', predicate: 'title', valueString: value })

  it('flags a claim whose only source was removed from the Library', async () => {
    const id = await title('Queen')
    await cite(id, doc.gone, 'Sera, Queen of Ashfall')
    const [conflict, ...rest] = vanished(await loadConflicts(db, userId))
    expect(rest).toEqual([])
    expect(conflict!.key).toBe(id)
    // The evidence survives the document (ADR §7a), and is not linked.
    expect(conflict!.claim.sources).toEqual([
      expect.objectContaining({ quote: 'Sera, Queen of Ashfall', documentName: 'Old Chronicle', removed: true, webViewLink: null }),
    ])
  })

  it('flags trashed and hard-gone documents too', async () => {
    const trashed = await title('Warden')
    await cite(trashed, doc.trashed)
    const hardGone = await title('Regent')
    await cite(hardGone, null)
    const found = vanished(await loadConflicts(db, userId)).map((c) => c.key)
    expect(found.sort()).toEqual([trashed, hardGone].sort())
    // A source whose document row is gone falls back to the snapshotted name.
    const gone = vanished(await loadConflicts(db, userId)).find((c) => c.key === hardGone)!
    expect(gone.claim.sources[0]!.documentName).toBe('Snapshot name')
  })

  it('does not flag a claim with at least one live source', async () => {
    const id = await title('Queen')
    await cite(id, doc.gone, 'a', 1)
    await cite(id, doc.live, 'b', 2)
    expect(vanished(await loadConflicts(db, userId))).toEqual([])
  })

  it('never flags a claim entered by hand with no sources', async () => {
    await title('Queen')
    expect(await loadConflicts(db, userId)).toEqual([])
  })

  it('clears by itself when the document comes back', async () => {
    const id = await title('Queen')
    await cite(id, doc.gone)
    expect(vanished(await loadConflicts(db, userId))).toHaveLength(1)
    await pg.query('update documents set removed_at = null where id = $1', [doc.gone])
    expect(vanished(await loadConflicts(db, userId))).toEqual([])
  })

  it('shows a relationship and its inverse once, in the declared direction', async () => {
    const [forward, inverse] = await both(
      { subject: sera, subjectType: 'character', predicate: 'rules', object: ashfall, objectType: 'settlement' },
      'ruled_by',
    )
    await cite(forward, doc.gone)
    await cite(inverse, doc.gone)
    const [conflict, ...rest] = vanished(await loadConflicts(db, userId))
    expect(rest).toEqual([])
    expect(conflict!.claim.id).toBe(forward)
    expect(conflict!.partnerId).toBe(inverse)
  })

  it('honours a dismissal stored under either direction, and restores it', async () => {
    const [forward, inverse] = await both(
      { subject: sera, subjectType: 'character', predicate: 'rules', object: ashfall, objectType: 'settlement' },
      'ruled_by',
    )
    await cite(forward, doc.gone)
    await cite(inverse, doc.gone)
    await dismissConflict(db, userId, 'vanished_source', inverse)

    const [conflict] = vanished(await loadConflicts(db, userId))
    expect(conflict!.dismissed).toBe(true)

    await restoreConflict(db, userId, conflict!)
    const [restored] = vanished(await loadConflicts(db, userId))
    expect(restored!.dismissed).toBe(false)
  })
})
