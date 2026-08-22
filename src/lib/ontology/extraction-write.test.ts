import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { eq, sql } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { NeonDatabase } from 'drizzle-orm/neon-serverless'
import * as schema from '@/db/schema'
import { applyMigrations, seedCatalog } from '@/test/catalog'
import type { ExtractedClaim } from './extraction'
import { writeExtraction, type ExtractionContext } from './extraction-write'

/**
 * The write path against a real Postgres running the real migrations, for the
 * same reason `constraints.test.ts` does it: what is being asserted here is
 * idempotency and provenance, and both live in the catalog — a generated
 * fingerprint column, a unique index over it, and a signature foreign key. A
 * mocked database would test this file's opinion of Postgres rather than
 * Postgres, and the interesting failures are exactly the ones where those two
 * differ.
 */

let pg: PGlite
let db: NeonDatabase<typeof schema>
let userId: string
let documentId: string

const CONTEXT: Omit<ExtractionContext, 'documentId'> = {
  documentName: 'Town of Gabelford',
  headRevisionId: 'rev-42',
  driveVersion: 191,
  model: 'test/model',
}

const context = (over: Partial<ExtractionContext> = {}): ExtractionContext => ({
  ...CONTEXT,
  documentId,
  ...over,
})

/** A minimal valid extracted claim; the ontology's own `rules` predicate. */
function rulesClaim(over: Partial<ExtractedClaim> = {}): ExtractedClaim {
  return {
    subjectName: 'Sera Vane',
    subjectType: 'character',
    predicate: 'rules',
    objectName: 'Ashfall',
    objectType: 'settlement',
    quote: 'Sera Vane rules Ashfall.',
    paragraphIndex: 4,
    ...over,
  }
}

beforeAll(async () => {
  pg = new PGlite()
  await applyMigrations(pg)
  await seedCatalog(pg)
  db = drizzle(pg, { schema }) as unknown as NeonDatabase<typeof schema>
}, 180_000)

beforeEach(async () => {
  await pg.exec('delete from claim_sources; delete from claims; delete from entities;')
  await pg.exec('delete from documents; delete from sync_state; delete from users;')

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
})

async function entityRows() {
  return db.select().from(schema.entities).where(eq(schema.entities.userId, userId))
}
async function claimRows() {
  return db.select().from(schema.claims).where(eq(schema.claims.userId, userId))
}
async function sourceRows() {
  return db.select().from(schema.claimSources).where(eq(schema.claimSources.userId, userId))
}

describe('entities', () => {
  it('creates a draft for a name the graph has never heard of', async () => {
    const result = await writeExtraction(db, userId, [rulesClaim()], context())

    expect(result.entitiesCreated).toHaveLength(2)
    const rows = await entityRows()
    expect(rows.map((r) => r.name).sort()).toEqual(['Ashfall', 'Sera Vane'])

    for (const row of rows) {
      // Draft, attributed, and traceable to the document that proposed it —
      // the three things that make minting one without asking defensible.
      expect(row.canonicity).toBe('draft')
      expect(row.createdBy).toBe('llm')
      expect(row.extractedByModel).toBe('test/model')
      expect(row.sourceDocumentId).toBe(documentId)
    }
  })

  it('never mints a second entity for a name that already resolves', async () => {
    await pg.query(
      `insert into entities (user_id, entity_type, name, normalized_name, canonicity, created_by)
       values ($1, 'character', 'Sera Vane', 'sera vane', 'canon', 'user')`,
      [userId],
    )

    const result = await writeExtraction(db, userId, [rulesClaim()], context())

    expect(result.entitiesCreated.map((e) => e.name)).toEqual(['Ashfall'])
    const sera = (await entityRows()).filter((r) => r.name === 'Sera Vane')
    expect(sera).toHaveLength(1)
    // The existing entity is untouched — still canon, still the user's.
    expect(sera[0]!.canonicity).toBe('canon')
    expect(sera[0]!.createdBy).toBe('user')
  })

  it('collapses near-miss spellings within a run into one entity', async () => {
    // 'the Veche' and 'Veche' normalise to the same key, so a single document
    // must not produce two drafts of the same thing.
    await writeExtraction(
      db,
      userId,
      [
        rulesClaim({ subjectName: 'the Veche', objectName: 'Ashfall' }),
        rulesClaim({ subjectName: 'Veche', objectName: 'Ashfall' }),
      ],
      context(),
    )

    const veche = (await entityRows()).filter((r) => r.entityType === 'character')
    expect(veche).toHaveLength(1)
  })
})

describe('idempotency', () => {
  it('re-extracting an unchanged document changes nothing', async () => {
    const claims = [rulesClaim()]

    const first = await writeExtraction(db, userId, claims, context())
    expect(first.claimsCreated).toBe(1)

    const second = await writeExtraction(db, userId, claims, context())
    expect(second.claimsCreated).toBe(0)
    expect(second.claimsAlreadyPresent).toBe(1)
    expect(second.sourcesCreated).toBe(0)
    expect(second.entitiesCreated).toHaveLength(0)

    expect(await claimRows()).toHaveLength(1)
    expect(await sourceRows()).toHaveLength(1)
    expect(await entityRows()).toHaveLength(2)
  })

  it('adds new claims on a re-run without disturbing the old ones', async () => {
    await writeExtraction(db, userId, [rulesClaim()], context())

    const result = await writeExtraction(
      db,
      userId,
      [rulesClaim(), rulesClaim({ predicate: 'born_in', objectName: 'Ashfall' })],
      context(),
    )

    expect(result.claimsCreated).toBe(1)
    expect(result.claimsAlreadyPresent).toBe(1)
    expect(await claimRows()).toHaveLength(2)
  })

  it('leaves a claim a person promoted to canon alone', async () => {
    await writeExtraction(db, userId, [rulesClaim()], context())
    await pg.query(`update claims set canonicity = 'canon', created_by = 'user'`)

    await writeExtraction(db, userId, [rulesClaim()], context())

    const rows = await claimRows()
    expect(rows).toHaveLength(1)
    // The upsert's conflict action must not be able to demote this.
    expect(rows[0]!.canonicity).toBe('canon')
    expect(rows[0]!.createdBy).toBe('user')
  })

  it('does not accumulate duplicate sources for a claim quoted without a paragraph', async () => {
    // `(claim_id, document_id, paragraph_index)` is unique, but Postgres treats
    // nulls as distinct — so this case needs the explicit read-before-write.
    const claim = rulesClaim({ paragraphIndex: undefined })

    await writeExtraction(db, userId, [claim], context())
    await writeExtraction(db, userId, [claim], context())

    expect(await sourceRows()).toHaveLength(1)
  })

  it('keeps both citations when one fact is asserted from two paragraphs', async () => {
    const result = await writeExtraction(
      db,
      userId,
      [
        rulesClaim({ paragraphIndex: 4, quote: 'Sera Vane rules Ashfall.' }),
        rulesClaim({ paragraphIndex: 9, quote: 'Ashfall answers to Sera Vane.' }),
      ],
      context(),
    )

    expect(result.claimsCreated).toBe(1)
    expect(result.sourcesCreated).toBe(2)
    expect((await sourceRows()).map((s) => s.paragraphIndex).sort()).toEqual([4, 9])
  })
})

describe('sources', () => {
  it('snapshots the evidence so a citation survives its document', async () => {
    await writeExtraction(db, userId, [rulesClaim()], context())

    const [source] = await sourceRows()
    expect(source).toMatchObject({
      documentId,
      documentName: 'Town of Gabelford',
      quote: 'Sera Vane rules Ashfall.',
      paragraphIndex: 4,
      documentRevisionId: 'rev-42',
    })
  })

  it('keeps the quote and paragraph after the document is deleted (§7a)', async () => {
    await writeExtraction(db, userId, [rulesClaim()], context())
    await pg.query('delete from documents where id = $1', [documentId])

    const [source] = await sourceRows()
    // document_id is ON DELETE SET NULL; everything a reader needs is a snapshot.
    expect(source!.documentId).toBeNull()
    expect(source!.documentName).toBe('Town of Gabelford')
    expect(source!.quote).toBe('Sera Vane rules Ashfall.')
    expect(await claimRows()).toHaveLength(1)
  })
})

describe('provenance', () => {
  it('stamps the model on every claim and marks the document extracted', async () => {
    await writeExtraction(db, userId, [rulesClaim()], context())

    expect((await claimRows())[0]).toMatchObject({
      canonicity: 'draft',
      createdBy: 'llm',
      extractedByModel: 'test/model',
    })

    const [doc] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId))

    expect(doc).toMatchObject({
      // 'extracted', never 'verified' — that word is a person's to say.
      status: 'extracted',
      extractedRevisionId: 'rev-42',
      extractedDriveVersion: 191,
    })
  })

  it('stamps a document that produced no claims at all', async () => {
    await writeExtraction(db, userId, [], context())

    const [doc] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId))

    // Otherwise an empty document is retried forever, looking never-extracted.
    expect(doc!.status).toBe('extracted')
    expect(doc!.extractedDriveVersion).toBe(191)
  })
})

describe('what is refused', () => {
  it('refuses a claim whose name matches two entities, rather than guessing', async () => {
    for (const _ of [1, 2]) {
      await pg.query(
        `insert into entities (user_id, entity_type, name, normalized_name, canonicity)
         values ($1, 'character', 'Sera Vane', 'sera vane', 'canon')`,
        [userId],
      )
    }

    const result = await writeExtraction(db, userId, [rulesClaim()], context())

    expect(result.unwritten).toHaveLength(1)
    expect(result.unwritten[0]!.code).toBe('entity_ambiguous')
    expect(await claimRows()).toHaveLength(0)
  })

  it('refuses a type disagreement instead of adopting either side', async () => {
    await pg.query(
      `insert into entities (user_id, entity_type, name, normalized_name, canonicity)
       values ($1, 'faction', 'Ashfall', 'ashfall', 'canon')`,
      [userId],
    )

    const result = await writeExtraction(db, userId, [rulesClaim()], context())

    expect(result.unwritten[0]!.code).toBe('entity_type_mismatch')
    expect(result.unwritten[0]!.message).toContain('faction')
    // And it did not quietly mint a second Ashfall under the model's type.
    expect((await entityRows()).filter((e) => e.name === 'Ashfall')).toHaveLength(1)
  })

  it('refuses a claim that relates an entity to itself through an alias', async () => {
    // `sibling_of` is character→character, so the shape is legal and the
    // catalog would accept it — the only thing stopping "Sera is her own
    // sibling" is this path noticing the alias resolved to the same row.
    await pg.query(
      `insert into entities (user_id, entity_type, name, normalized_name, canonicity, name_variants)
       values ($1, 'character', 'Sera Vane', 'sera vane', 'canon', '["The Vane"]'::jsonb)`,
      [userId],
    )

    const result = await writeExtraction(
      db,
      userId,
      [
        {
          subjectName: 'Sera Vane',
          subjectType: 'character',
          predicate: 'sibling_of',
          objectName: 'The Vane',
          objectType: 'character',
          quote: 'Sera Vane, known as the Vane.',
        },
      ],
      context(),
    )

    expect(result.unwritten[0]!.code).toBe('entity_ambiguous')
    expect(await claimRows()).toHaveLength(0)
  })

  it('writes the good claims in a batch that also contains a bad one', async () => {
    await pg.query(
      `insert into entities (user_id, entity_type, name, normalized_name, canonicity)
       values ($1, 'faction', 'Ashfall', 'ashfall', 'canon')`,
      [userId],
    )

    const result = await writeExtraction(
      db,
      userId,
      [
        rulesClaim(), // Ashfall is a faction here, not a settlement — refused.
        rulesClaim({ objectName: 'Gabelford' }), // fine
      ],
      context(),
    )

    expect(result.unwritten).toHaveLength(1)
    expect(result.claimsCreated).toBe(1)
    expect(await claimRows()).toHaveLength(1)
  })
})

describe('attribute claims', () => {
  it('routes a value into the column its predicate declares, with a sort key', async () => {
    const result = await writeExtraction(
      db,
      userId,
      [
        {
          subjectName: 'Ashfall',
          subjectType: 'settlement',
          predicate: 'population',
          valueInt: 1800,
          quote: 'Approx. 1,800 souls.',
          paragraphIndex: 2,
        },
      ],
      context(),
    )

    expect(result.claimsCreated).toBe(1)
    const [claim] = await claimRows()
    expect(claim!.valueInt).toBe(1800)
    expect(claim!.objectId).toBeNull()
  })

  it('rolls the whole run back when the catalog refuses one row', async () => {
    // The transaction is the reason this matters: a half-written extraction —
    // entities minted, document stamped, claims missing — is worse than none,
    // because nothing downstream could tell it from a real one.
    await expect(
      writeExtraction(
        db,
        userId,
        [
          rulesClaim(),
          {
            subjectName: 'Ashfall',
            subjectType: 'settlement',
            predicate: 'rules',
            valueString: 'nonsense',
            quote: 'x',
          },
        ],
        context(),
      ),
    ).rejects.toThrow()

    expect(await claimRows()).toHaveLength(0)
    expect(await entityRows()).toHaveLength(0)

    const [doc] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId))
    expect(doc!.status).toBe('unread')
    expect(doc!.extractedDriveVersion).toBeNull()
  })

  it('lets the catalog reject a claim the ontology forbids', async () => {
    // The signature foreign key is the backstop that cannot be bypassed. This
    // shape never reaches here in practice — parseExtraction refuses it first —
    // so the assertion is that the write path does not somehow slip past it.
    await expect(
      writeExtraction(
        db,
        userId,
        [
          {
            subjectName: 'Ashfall',
            subjectType: 'settlement',
            predicate: 'rules',
            valueString: 'nonsense',
            quote: 'x',
          },
        ],
        context(),
      ),
    ).rejects.toThrow()
  })
})

describe('scoping', () => {
  it('writes nothing for another user’s document', async () => {
    const others = await pg.query<{ id: string }>(
      `insert into users (google_sub, email) values ('sub-2', 'b@example.test') returning id`,
    )
    const otherUserId = others.rows[0]!.id

    await writeExtraction(db, userId, [rulesClaim()], context())

    const [count] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.claims)
      .where(eq(schema.claims.userId, otherUserId))

    expect(count!.n).toBe(0)
  })
})
