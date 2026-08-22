import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { applyMigrations, seedCatalog } from '@/test/catalog'

/**
 * The ontology's guarantee is that an invalid claim *cannot be written* — not
 * that we remember to check. That guarantee lives in the catalog (foreign keys,
 * check constraints, generated columns), so the only honest way to test it is
 * against a real Postgres running the real migrations.
 *
 * PGlite is Postgres compiled to WASM: same planner, same constraint semantics,
 * no daemon and no container. The migrations are applied verbatim from
 * ./drizzle, so this also catches a migration that Drizzle generated but
 * Postgres won't accept.
 *
 * If a constraint here starts failing, do not relax the test — the schema and
 * the registry have disagreed about something, and one of them is wrong.
 */

let db: PGlite
let userId: string
let otherUserId: string
const ids: Record<string, string> = {}

async function insertEntity(type: string, name: string, owner = userId): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into entities (user_id, entity_type, name, normalized_name, canonicity)
     values ($1, $2, $3, $4, 'canon') returning id`,
    [owner, type, name, name.toLowerCase()],
  )
  return rows[0]!.id
}

/** Runs a statement and returns the constraint name it violated, or null. */
async function violation(sql: string, params: unknown[] = []): Promise<string | null> {
  try {
    await db.query(sql, params)
    return null
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return /constraint "([^"]+)"/.exec(message)?.[1] ?? message.split('\n')[0]!
  }
}

const claim = (columns: string) => {
  const placeholders = columns.split(',').map((_, i) => `$${i + 2}`)
  return `insert into claims (user_id, ${columns}) values ($1, ${placeholders.join(', ')})`
}

beforeAll(async () => {
  db = new PGlite()

  await applyMigrations(db)

  const users = await db.query<{ id: string }>(
    `insert into users (google_sub, email)
     values ('sub-1', 'a@example.test'), ('sub-2', 'b@example.test') returning id`,
  )
  userId = users.rows[0]!.id
  otherUserId = users.rows[1]!.id

  // The vocabulary is global, so it is seeded once rather than per user.
  await seedCatalog(db)

  ids.sera = await insertEntity('character', 'Sera')
  ids.kaine = await insertEntity('character', 'Kaine')
  ids.ashfall = await insertEntity('settlement', 'Ashfall')
  ids.crown = await insertEntity('artifact', 'Bronze Crown')
}, 180_000)

describe('claims the ontology accepts', () => {
  it('takes a legal relationship', async () => {
    expect(
      await violation(claim('subject_id, subject_type, predicate, object_id, object_type'), [
        userId, ids.ashfall, 'settlement', 'ruled_by', ids.sera, 'character',
      ]),
    ).toBeNull()
  })

  it('takes a legal attribute', async () => {
    expect(
      await violation(claim('subject_id, subject_type, predicate, value_int'), [
        userId, ids.ashfall, 'settlement', 'population', 12_000,
      ]),
    ).toBeNull()
  })

  it('takes an in-world validity window as text plus a sort key', async () => {
    expect(
      await violation(
        claim('subject_id, subject_type, predicate, object_id, object_type, start_time, start_order'),
        [userId, ids.sera, 'character', 'married_to', ids.kaine, 'character', 'Third Age, 412', 412],
      ),
    ).toBeNull()
  })

  it('allows one name across two entity types', async () => {
    await expect(insertEntity('region', 'Ashfall')).resolves.toBeTruthy()
  })
})

describe('the signature foreign key', () => {
  it('rejects an invented predicate', async () => {
    expect(
      await violation(claim('subject_id, subject_type, predicate, object_id, object_type'), [
        userId, ids.ashfall, 'settlement', 'governs', ids.sera, 'character',
      ]),
    ).toBe('claims_signature_fk')
  })

  it('rejects an illegal object type (range)', async () => {
    expect(
      await violation(claim('subject_id, subject_type, predicate, object_id, object_type'), [
        userId, ids.ashfall, 'settlement', 'married_to', ids.crown, 'artifact',
      ]),
    ).toBe('claims_signature_fk')
  })

  it('rejects an illegal subject type (domain)', async () => {
    expect(
      await violation(claim('subject_id, subject_type, predicate, object_id, object_type'), [
        userId, ids.crown, 'artifact', 'ruled_by', ids.sera, 'character',
      ]),
    ).toBe('claims_signature_fk')
  })

  it('rejects an attribute predicate used with an object', async () => {
    expect(
      await violation(claim('subject_id, subject_type, predicate, object_id, object_type'), [
        userId, ids.ashfall, 'settlement', 'population', ids.sera, 'character',
      ]),
    ).toBe('claims_signature_fk')
  })

  /**
   * The reason `object_type_key` and `value_kind` exist. A relationship claim
   * written with a value has a NULL object_type, and under MATCH SIMPLE that
   * NULL would switch the whole foreign key off — letting every malformed
   * attribute claim through the one constraint meant to catch it.
   */
  it('rejects a relationship predicate used with a value, despite the NULL', async () => {
    expect(
      await violation(claim('subject_id, subject_type, predicate, value_string'), [
        userId, ids.ashfall, 'settlement', 'ruled_by', 'Sera',
      ]),
    ).toBe('claims_signature_fk')
  })

  it('rejects a value in the wrong column for the declared type', async () => {
    expect(
      await violation(claim('subject_id, subject_type, predicate, value_string'), [
        userId, ids.ashfall, 'settlement', 'population', 'twelve thousand',
      ]),
    ).toBe('claims_signature_fk')
  })
})

describe('claim shape', () => {
  it('rejects two populated value columns', async () => {
    expect(
      await violation(claim('subject_id, subject_type, predicate, value_int, value_string'), [
        userId, ids.ashfall, 'settlement', 'population', 1, 'x',
      ]),
    ).toBe('claims_value_arity')
  })

  it('rejects an attribute with no value at all', async () => {
    expect(
      await violation(claim('subject_id, subject_type, predicate'), [
        userId, ids.ashfall, 'settlement', 'population',
      ]),
    ).toBe('claims_value_arity')
  })

  it('rejects a self-relation', async () => {
    expect(
      await violation(claim('subject_id, subject_type, predicate, object_id, object_type'), [
        userId, ids.sera, 'character', 'married_to', ids.sera, 'character',
      ]),
    ).toBe('claims_no_self_relation')
  })

  it('rejects a validity window that ends before it starts', async () => {
    expect(
      await violation(
        claim('subject_id, subject_type, predicate, object_id, object_type, start_order, end_order'),
        [userId, ids.sera, 'character', 'rules', ids.ashfall, 'settlement', 500, 400],
      ),
    ).toBe('claims_time_order')
  })

  /** What makes re-extracting a document an upsert rather than a duplicate. */
  it('rejects a claim identical to one already stored', async () => {
    expect(
      await violation(claim('subject_id, subject_type, predicate, object_id, object_type'), [
        userId, ids.ashfall, 'settlement', 'ruled_by', ids.sera, 'character',
      ]),
    ).toBe('claims_user_fingerprint_uq')
  })
})

describe('entity integrity', () => {
  it('rejects a claim whose subject_type contradicts the entity', async () => {
    expect(
      await violation(claim('subject_id, subject_type, predicate, value_int'), [
        userId, ids.ashfall, 'region', 'population', 900,
      ]),
    ).toBe('claims_subject_fk')
  })

  /**
   * Still enforced after the vocabulary went global: tenant isolation comes
   * from user_id participating in the claims → entities foreign keys, which the
   * reference tables were never part of.
   */
  it('rejects a claim reaching into another user’s entities', async () => {
    expect(
      await violation(claim('subject_id, subject_type, predicate, value_int'), [
        otherUserId, ids.ashfall, 'settlement', 'population', 5,
      ]),
    ).toBe('claims_subject_fk')
  })

  /**
   * Two characters may genuinely share a name, so this is allowed at the schema
   * level on purpose. Suppressing accidental duplicates is the entity matcher's
   * job — it must resolve an exact normalized hit to the existing row or raise
   * the collision, never silently mint a second one.
   */
  it('permits a same-named entity of the same type', async () => {
    expect(
      await violation(
        `insert into entities (user_id, entity_type, name, normalized_name)
         values ($1, 'character', 'Sera of Ashfall', 'sera')`,
        [userId],
      ),
    ).toBeNull()
  })

  it('cascades a retyped entity into its claims', async () => {
    const id = await insertEntity('faction', 'The Pale Hand')
    await db.query(claim('subject_id, subject_type, predicate, value_int'), [
      userId, id, 'faction', 'population', 300,
    ])

    expect(await violation(`update entities set entity_type = 'society' where id = $1`, [id])).toBeNull()

    const { rows } = await db.query<{ subject_type: string }>(
      `select subject_type from claims where subject_id = $1`,
      [id],
    )
    expect(rows[0]!.subject_type).toBe('society')
  })
})
