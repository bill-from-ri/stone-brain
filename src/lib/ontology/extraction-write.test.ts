import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { eq, sql } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { NeonDatabase } from 'drizzle-orm/neon-serverless'
import * as schema from '@/db/schema'
import { applyMigrations, seedCatalog } from '@/test/catalog'
import type { Paragraph } from '@/lib/drive/markdown'
import { loadExistingClaims } from './existing-claims'
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
    expect(first.inversesCreated).toBe(1)

    const second = await writeExtraction(db, userId, claims, context())
    expect(second.claimsCreated).toBe(0)
    expect(second.claimsAlreadyPresent).toBe(1)
    expect(second.inversesCreated).toBe(0)
    expect(second.sourcesCreated).toBe(0)
    expect(second.entitiesCreated).toHaveLength(0)

    // The claim and its inverse, each cited once.
    expect(await claimRows()).toHaveLength(2)
    expect(await sourceRows()).toHaveLength(2)
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
    expect(result.inversesCreated).toBe(1)
    // rules + ruled_by, born_in + birthplace_of.
    expect(await claimRows()).toHaveLength(4)
  })

  it('leaves a claim a person promoted to canon alone', async () => {
    await writeExtraction(db, userId, [rulesClaim()], context())
    await pg.query(`update claims set canonicity = 'canon', created_by = 'user'`)

    await writeExtraction(db, userId, [rulesClaim()], context())

    const rows = await claimRows()
    expect(rows).toHaveLength(2)
    // The upsert's conflict action must not be able to demote either direction.
    for (const row of rows) {
      expect(row.canonicity).toBe('canon')
      expect(row.createdBy).toBe('user')
    }
  })

  it('does not accumulate duplicate sources for a claim quoted without a paragraph', async () => {
    // `(claim_id, document_id, paragraph_index)` is unique, but Postgres treats
    // nulls as distinct — so this case needs the explicit read-before-write.
    const claim = rulesClaim({ paragraphIndex: undefined })

    await writeExtraction(db, userId, [claim], context())
    await writeExtraction(db, userId, [claim], context())

    // One for the claim, one mirrored onto its inverse — and no more.
    expect(await sourceRows()).toHaveLength(2)
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
    // Both citations, on both directions.
    expect((await sourceRows()).map((s) => s.paragraphIndex).sort()).toEqual([4, 4, 9, 9])
  })
})

describe('inverses', () => {
  it('writes the reverse direction, cited by the same passage', async () => {
    const result = await writeExtraction(db, userId, [rulesClaim()], context())

    expect(result.claimsCreated).toBe(1)
    expect(result.inversesCreated).toBe(1)
    // The citation as stated; the mirrored copy is not counted again.
    expect(result.sourcesCreated).toBe(1)

    const rows = await claimRows()
    const entities = new Map((await entityRows()).map((e) => [e.name, e.id]))
    const inverse = rows.find((r) => r.predicate === 'ruled_by')
    expect(inverse).toMatchObject({
      subjectId: entities.get('Ashfall'),
      subjectType: 'settlement',
      objectId: entities.get('Sera Vane'),
      objectType: 'character',
      canonicity: 'draft',
      createdBy: 'llm',
      extractedByModel: 'test/model',
    })

    const sources = await sourceRows()
    const cited = sources.find((s) => s.claimId === inverse!.id)
    // An inverse without a source would read as entered by hand.
    expect(cited).toMatchObject({
      documentId,
      quote: 'Sera Vane rules Ashfall.',
      paragraphIndex: 4,
      documentRevisionId: 'rev-42',
    })
  })

  it('carries the time bounds over to the inverse', async () => {
    await writeExtraction(
      db,
      userId,
      [rulesClaim({ startTime: '400 AD', endTime: '412 AD' })],
      context(),
    )

    const inverse = (await claimRows()).find((r) => r.predicate === 'ruled_by')
    expect(inverse).toMatchObject({ startTime: '400 AD', endTime: '412 AD' })
    expect(inverse!.startOrder).not.toBeNull()
  })

  it('does not double up when the document states both directions', async () => {
    const result = await writeExtraction(
      db,
      userId,
      [
        rulesClaim(),
        {
          subjectName: 'Ashfall',
          subjectType: 'settlement',
          predicate: 'ruled_by',
          objectName: 'Sera Vane',
          objectType: 'character',
          quote: 'Ashfall is ruled by Sera Vane.',
          paragraphIndex: 6,
        },
      ],
      context(),
    )

    // Two claims the model stated, each the other's inverse: nothing derived.
    expect(result.claimsCreated).toBe(2)
    expect(result.inversesCreated).toBe(0)
    expect(await claimRows()).toHaveLength(2)

    // Each direction is cited by both passages.
    for (const claim of await claimRows()) {
      const paragraphs = (await sourceRows())
        .filter((s) => s.claimId === claim.id)
        .map((s) => s.paragraphIndex)
        .sort()
      expect(paragraphs, claim.predicate).toEqual([4, 6])
    }
  })

  it('writes a symmetric predicate once in each direction', async () => {
    const married = (subjectName: string, objectName: string): ExtractedClaim => ({
      subjectName,
      subjectType: 'character',
      predicate: 'married_to',
      objectName,
      objectType: 'character',
      quote: 'Sera Vane married Tomas Ord.',
      paragraphIndex: 2,
    })

    const first = await writeExtraction(db, userId, [married('Sera Vane', 'Tomas Ord')], context())
    expect(first.inversesCreated).toBe(1)

    // The reverse, stated later, is already there.
    const second = await writeExtraction(
      db,
      userId,
      [married('Tomas Ord', 'Sera Vane')],
      context(),
    )
    expect(second.claimsCreated).toBe(0)
    expect(second.claimsAlreadyPresent).toBe(1)
    expect(second.inversesCreated).toBe(0)

    const rows = await claimRows()
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.predicate === 'married_to')).toBe(true)
  })

  it('writes no inverse for an attribute', async () => {
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
        },
      ],
      context(),
    )

    expect(result.inversesCreated).toBe(0)
    expect(await claimRows()).toHaveLength(1)
  })

  it('leaves an inverse a person already wrote untouched, and cites it', async () => {
    const sera = await pg.query<{ id: string }>(
      `insert into entities (user_id, entity_type, name, normalized_name, canonicity, created_by)
       values ($1, 'character', 'Sera Vane', 'sera vane', 'canon', 'user') returning id`,
      [userId],
    )
    const ashfall = await pg.query<{ id: string }>(
      `insert into entities (user_id, entity_type, name, normalized_name, canonicity, created_by)
       values ($1, 'settlement', 'Ashfall', 'ashfall', 'canon', 'user') returning id`,
      [userId],
    )
    await pg.query(
      `insert into claims (user_id, subject_id, subject_type, predicate, object_id, object_type,
                           canonicity, created_by)
       values ($1, $2, 'settlement', 'ruled_by', $3, 'character', 'canon', 'user')`,
      [userId, ashfall.rows[0]!.id, sera.rows[0]!.id],
    )

    const result = await writeExtraction(db, userId, [rulesClaim()], context())
    expect(result.claimsCreated).toBe(1)
    expect(result.inversesCreated).toBe(0)

    const inverse = (await claimRows()).find((r) => r.predicate === 'ruled_by')!
    expect(inverse.canonicity).toBe('canon')
    expect(inverse.createdBy).toBe('user')
    // It is now evidenced by the document that stated its mirror.
    expect((await sourceRows()).some((s) => s.claimId === inverse.id)).toBe(true)
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
    expect(await claimRows()).toHaveLength(2)
  })
})

describe('provenance', () => {
  it('stamps the model on every claim and marks the document extracted', async () => {
    await writeExtraction(db, userId, [rulesClaim()], context())

    // The inverse included: it is no more canon than the claim it mirrors.
    for (const row of await claimRows()) {
      expect(row).toMatchObject({
        canonicity: 'draft',
        createdBy: 'llm',
        extractedByModel: 'test/model',
      })
    }

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
    expect(await claimRows()).toHaveLength(2)
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

describe('re-extraction', () => {
  /** The current text: paragraph `at` holds each given line, the rest are filler. */
  const paragraphsWith = (lines: Record<number, string>): Paragraph[] =>
    Array.from({ length: 8 }, (_, index) => ({
      index,
      text: lines[index] ?? `Filler paragraph ${index}.`,
      headings: [],
      kind: 'prose' as const,
    }))

  const load = (paragraphs: Paragraph[]) => loadExistingClaims(db, userId, documentId, paragraphs)

  async function secondDocument(): Promise<string> {
    const docs = await pg.query<{ id: string }>(
      `insert into documents (user_id, drive_file_id, name, mime_type, raw)
       values ($1, 'drive-2', 'Annals of Ashfall', 'application/vnd.google-apps.document', '{}')
       returning id`,
      [userId],
    )
    return docs.rows[0]!.id
  }

  it('shows each fact once, with its inverse riding along', async () => {
    await writeExtraction(db, userId, [rulesClaim()], context())

    const existing = await load(paragraphsWith({ 4: 'Sera Vane rules Ashfall.' }))

    expect(existing).toHaveLength(1)
    // Either direction may be the one shown; it is the same fact.
    const shown = existing[0]!
    expect(shown.handle).toBe('c1')
    expect([
      [shown.subjectName, shown.predicate, shown.objectName],
    ]).toContainEqual(
      shown.predicate === 'rules' ? ['Sera Vane', 'rules', 'Ashfall'] : ['Ashfall', 'ruled_by', 'Sera Vane'],
    )
    expect(existing[0]!.members).toHaveLength(2)
    expect(existing[0]!.members[0]!.sources[0]).toMatchObject({ paragraphIndex: 4, foundAt: 4 })
  })

  it('reports where a quote is now, or that it is gone', async () => {
    await writeExtraction(db, userId, [rulesClaim()], context())

    const moved = await load(paragraphsWith({ 6: 'Sera Vane rules Ashfall.' }))
    expect(moved[0]!.members[0]!.sources[0]!.foundAt).toBe(6)

    const gone = await load(paragraphsWith({ 4: 'Sera Vane abdicated.' }))
    expect(gone[0]!.members[0]!.sources[0]!.foundAt).toBeNull()
  })

  it('keeps every claim the model did not mention, exactly as stored', async () => {
    await writeExtraction(db, userId, [rulesClaim()], context())
    const before = await claimRows()
    const existing = await load(paragraphsWith({ 4: 'Sera Vane rules Ashfall.' }))

    const result = await writeExtraction(db, userId, [], context(), { existing, retractions: [] })

    expect(result.claimsRetracted).toBe(0)
    expect(await claimRows()).toEqual(before)
    expect(await sourceRows()).toHaveLength(2)
  })

  it('deletes a retracted draft, both directions, when this document was its only source', async () => {
    await writeExtraction(db, userId, [rulesClaim()], context())
    const existing = await load(paragraphsWith({ 4: 'Sera Vane abdicated.' }))

    const result = await writeExtraction(db, userId, [], context(), {
      existing,
      retractions: [{ handle: 'c1', reason: 'She abdicated.' }],
    })

    expect(result.claimsRetracted).toBe(1)
    expect(result.retractions).toEqual([
      expect.objectContaining({
        handle: 'c1',
        outcome: 'deleted',
        reason: 'She abdicated.',
        claim: expect.objectContaining({ predicate: expect.stringMatching(/^(rules|ruled_by)$/) }),
      }),
    ])
    expect(await claimRows()).toHaveLength(0)
    expect(await sourceRows()).toHaveLength(0)
  })

  it('only withdraws this document’s citation when another document still states it', async () => {
    const other = await secondDocument()
    await writeExtraction(db, userId, [rulesClaim()], context())
    await writeExtraction(db, userId, [rulesClaim()], context({ documentId: other, documentName: 'Annals' }))
    const existing = await load(paragraphsWith({ 4: 'Sera Vane abdicated.' }))

    const result = await writeExtraction(db, userId, [], context(), {
      existing,
      retractions: [{ handle: 'c1', reason: 'She abdicated.' }],
    })

    expect(result.retractions[0]!.outcome).toBe('citation_removed')
    expect(result.claimsRetracted).toBe(1)
    expect(await claimRows()).toHaveLength(2)
    const sources = await sourceRows()
    expect(sources).toHaveLength(2)
    expect(sources.every((s) => s.documentId === other)).toBe(true)
  })

  it('never removes a canon claim, and says why', async () => {
    await writeExtraction(db, userId, [rulesClaim()], context())
    await pg.query(`update claims set canonicity = 'canon'`)
    const existing = await load(paragraphsWith({ 4: 'Sera Vane abdicated.' }))

    const result = await writeExtraction(db, userId, [], context(), {
      existing,
      retractions: [{ handle: 'c1', reason: 'She abdicated.' }],
    })

    expect(result.claimsRetracted).toBe(0)
    expect(result.retractions[0]).toMatchObject({ outcome: 'held' })
    expect(result.retractions[0]!.detail).toContain('canon')
    expect(await claimRows()).toHaveLength(2)
    expect(await sourceRows()).toHaveLength(2)
  })

  it('never removes a claim a person wrote', async () => {
    await writeExtraction(db, userId, [rulesClaim()], context())
    await pg.query(`update claims set created_by = 'user'`)
    const existing = await load(paragraphsWith({}))

    const result = await writeExtraction(db, userId, [], context(), {
      existing,
      retractions: [{ handle: 'c1', reason: 'Gone.' }],
    })

    expect(result.retractions[0]!.outcome).toBe('held')
    expect(await claimRows()).toHaveLength(2)
  })

  it('keeps a claim the same run both retracted and re-asserted', async () => {
    await writeExtraction(db, userId, [rulesClaim()], context())
    const existing = await load(paragraphsWith({ 4: 'Sera Vane rules Ashfall.' }))

    const result = await writeExtraction(db, userId, [rulesClaim()], context(), {
      existing,
      retractions: [{ handle: 'c1', reason: 'Confused.' }],
    })

    expect(result.retractions[0]!.outcome).toBe('held')
    expect(await claimRows()).toHaveLength(2)
  })

  it('revises a claim: the corrected one in, the old one out', async () => {
    await writeExtraction(db, userId, [rulesClaim()], context())
    const existing = await load(paragraphsWith({ 4: 'Sera Vane ruled Ashfall until 412 AR.' }))

    const result = await writeExtraction(
      db,
      userId,
      [rulesClaim({ endTime: '412 AR', quote: 'Sera Vane ruled Ashfall until 412 AR.' })],
      context(),
      { existing, retractions: [{ handle: 'c1', reason: 'Her rule now ends in 412 AR.' }] },
    )

    expect(result.claimsCreated).toBe(1)
    expect(result.claimsRetracted).toBe(1)
    const rows = await claimRows()
    // The bounded claim and its inverse; the unbounded pair is gone.
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.endTime === '412 AR')).toBe(true)
  })

  it('re-points a kept citation, and its inverse’s, at the paragraph its quote moved to', async () => {
    await writeExtraction(db, userId, [rulesClaim()], context())
    const existing = await load(paragraphsWith({ 6: 'Sera Vane rules Ashfall.' }))

    const result = await writeExtraction(db, userId, [], context({ headRevisionId: 'rev-43' }), {
      existing,
      retractions: [],
    })

    expect(result.sourcesRelocated).toBe(2)
    const sources = await sourceRows()
    expect(sources).toHaveLength(2)
    for (const s of sources) {
      expect(s.paragraphIndex).toBe(6)
      expect(s.documentRevisionId).toBe('rev-43')
    }
  })

  it('folds a moved citation into one the claim already has there', async () => {
    await writeExtraction(db, userId, [rulesClaim()], context())
    const existing = await load(paragraphsWith({ 6: 'Sera Vane rules Ashfall.' }))

    // The model also re-emitted the claim from its new paragraph.
    await writeExtraction(db, userId, [rulesClaim({ paragraphIndex: 6 })], context(), {
      existing,
      retractions: [],
    })

    const sources = await sourceRows()
    expect(sources).toHaveLength(2)
    expect(sources.every((s) => s.paragraphIndex === 6)).toBe(true)
  })

  it('leaves a citation whose quote is nowhere where it was', async () => {
    await writeExtraction(db, userId, [rulesClaim()], context())
    const existing = await load(paragraphsWith({}))

    await writeExtraction(db, userId, [], context(), { existing, retractions: [] })

    expect((await sourceRows()).every((s) => s.paragraphIndex === 4)).toBe(true)
  })
})
