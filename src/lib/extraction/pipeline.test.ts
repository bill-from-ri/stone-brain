import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NeonDatabase } from 'drizzle-orm/neon-serverless'
import * as schema from '@/db/schema'
import { applyMigrations, seedCatalog } from '@/test/catalog'
import type { DocumentText } from '@/lib/documents/text'
import { ProviderError } from '@/lib/llm/errors'
import { ExtractionError, type ExtractionRun as ModelRun } from '@/lib/llm/extract'
import { coreOntology, type ExtractedClaim, type ProposedPredicate } from '@/lib/ontology/extraction'
import { writeExtraction } from '@/lib/ontology/extraction-write'
import { RUN_LEASE_MS } from './codes'
import { createRunner, type RunnerDeps } from './pipeline'
import { beginRun, decideProposal } from './record'

/**
 * The run service against a real Postgres, with only the outside world
 * stubbed: Drive's export and the model's reply are canned, and everything
 * between them — the write path, the run row, its issues, the proposals queue —
 * is the real code against the real migrations. What is under test is the
 * *record*, and a record is only worth asserting on where it is actually kept.
 *
 * No provider request is spent here, by construction: `extract` is a stub.
 */

let pg: PGlite
let db: NeonDatabase<typeof schema>
let userId: string
let documentId: string

const ontology = coreOntology()

const TEXT: DocumentText = {
  markdown: 'Sera Vane rules Ashfall.',
  paragraphs: [{ index: 0, text: 'Sera Vane rules Ashfall.', headings: [], kind: 'prose' }],
  headRevisionId: 'rev-7',
  strippedBytes: 0,
}

const rules = (over: Partial<ExtractedClaim> = {}): ExtractedClaim => ({
  subjectName: 'Sera Vane',
  subjectType: 'character',
  predicate: 'rules',
  objectName: 'Ashfall',
  objectType: 'settlement',
  quote: 'Sera Vane rules Ashfall.',
  paragraphIndex: 0,
  ...over,
})

const tradesWith: ProposedPredicate = {
  name: 'trades_with',
  description: 'A society that trades regularly with another.',
  subjectType: 'society',
  objectType: 'society',
  quote: 'Andras trades salt with Kaldia.',
  paragraphIndex: 0,
}

function modelRun(over: Partial<ModelRun> = {}): ModelRun {
  return {
    claims: [rules()],
    rejections: [],
    proposals: [],
    model: 'test/model-0613',
    attempts: 1,
    responseFormat: 'json_schema',
    usage: { promptTokens: 100, completionTokens: 20 },
    ...over,
  }
}

function deps(over: Partial<RunnerDeps> = {}): RunnerDeps & { recordHealth: ReturnType<typeof vi.fn> } {
  return {
    db,
    credentials: async () => ({ baseUrl: 'https://p.test/v1', apiKey: 'sk-x', modelId: 'test/model' }),
    readText: async () => TEXT,
    extract: async () => modelRun(),
    write: writeExtraction,
    ontology: () => ontology,
    recordHealth: vi.fn(async () => {}),
    logError: () => {},
    ...over,
  } as RunnerDeps & { recordHealth: ReturnType<typeof vi.fn> }
}

beforeAll(async () => {
  pg = new PGlite()
  await applyMigrations(pg)
  await seedCatalog(pg)
  db = drizzle(pg, { schema }) as unknown as NeonDatabase<typeof schema>
}, 180_000)

beforeEach(async () => {
  await pg.exec('delete from predicate_proposals; delete from extraction_issues; delete from extraction_runs;')
  await pg.exec('delete from claim_sources; delete from claims; delete from entities;')
  await pg.exec('delete from documents; delete from users;')

  const users = await pg.query<{ id: string }>(
    `insert into users (google_sub, email) values ('sub-1', 'a@example.test') returning id`,
  )
  userId = users.rows[0]!.id
  documentId = await insertDocument('drive-1', 'Town of Ashfall')
})

async function insertDocument(driveFileId: string, name: string, removed = false): Promise<string> {
  const docs = await pg.query<{ id: string }>(
    `insert into documents (user_id, drive_file_id, name, mime_type, raw, drive_version, removed_at)
     values ($1, $2, $3, 'application/vnd.google-apps.document', '{}', 191, $4)
     returning id`,
    [userId, driveFileId, name, removed ? new Date() : null],
  )
  return docs.rows[0]!.id
}

const runs = () => db.select().from(schema.extractionRuns).where(eq(schema.extractionRuns.userId, userId))
const issues = () =>
  db.select().from(schema.extractionIssues).where(eq(schema.extractionIssues.userId, userId))
const proposals = () =>
  db.select().from(schema.predicateProposals).where(eq(schema.predicateProposals.userId, userId))

describe('a successful run', () => {
  it('records the counts and stamps the document', async () => {
    const d = deps()
    const outcome = await createRunner(d)(userId, documentId)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.run).toMatchObject({
      status: 'succeeded',
      failure: null,
      model: 'test/model-0613',
      claimsExtracted: 1,
      claimsCreated: 1,
      claimsAlreadyPresent: 0,
      entitiesCreated: 2,
      dropped: 0,
    })
    // `rules` is a relationship with an inverse, so §5 writes the other direction.
    expect(outcome.run.inversesCreated).toBe(1)

    const [row] = await runs()
    expect(row).toMatchObject({
      status: 'succeeded',
      failureCode: null,
      failureMessage: null,
      modelRequested: 'test/model',
      model: 'test/model-0613',
      attempts: 1,
      responseFormat: 'json_schema',
      promptTokens: 100,
      completionTokens: 20,
      driveVersion: 191,
      revisionId: 'rev-7',
      claimsCreated: 1,
      inversesCreated: 1,
      sourcesCreated: 1,
      entitiesCreated: 2,
    })
    expect(row!.finishedAt).not.toBeNull()

    const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, documentId))
    expect(doc).toMatchObject({ status: 'extracted', extractedDriveVersion: 191 })

    // The call worked, so Settings should stop showing whatever the last failure was.
    expect(d.recordHealth).toHaveBeenCalledWith(userId, 'ok', null)
  })

  it('keeps every dropped claim, from both stages, with what the model actually sent', async () => {
    // Ashfall is a faction in the graph; the model calls it a settlement.
    await pg.query(
      `insert into entities (user_id, entity_type, name, normalized_name, canonicity, created_by)
       values ($1, 'faction', 'Ashfall', 'ashfall', 'canon', 'user')`,
      [userId],
    )
    const received = { subject: 'Sera Vane', predicate: 'governs', object: 'Ashfall' }
    const outcome = await createRunner(
      deps({
        extract: async () =>
          modelRun({
            rejections: [
              { index: 1, code: 'unknown_predicate', message: "'governs' is not in the vocabulary.", received },
            ],
          }),
      }),
    )(userId, documentId)

    expect(outcome.ok && outcome.run.dropped).toBe(2)

    const rows = await issues()
    const validation = rows.find((r) => r.stage === 'validation')!
    const write = rows.find((r) => r.stage === 'write')!

    expect(validation).toMatchObject({ code: 'unknown_predicate', position: 1, received })
    expect(write).toMatchObject({ code: 'entity_type_mismatch', position: null })
    expect(write.received).toMatchObject({ subjectName: 'Sera Vane', predicate: 'rules' })
  })

  it('files proposals into the queue', async () => {
    const outcome = await createRunner(
      deps({ extract: async () => modelRun({ proposals: [tradesWith] }) }),
    )(userId, documentId)

    expect(outcome.ok && outcome.run.proposalsFiled).toBe(1)
    const [row] = await proposals()
    expect(row).toMatchObject({
      name: 'trades_with',
      status: 'open',
      documentId,
      documentName: 'Town of Ashfall',
      subjectType: 'society',
      objectType: 'society',
      quote: 'Andras trades salt with Kaldia.',
      paragraphIndex: 0,
    })
    expect(row!.runId).toBe(outcome.ok ? outcome.run.runId : null)
  })
})

describe('a failed run', () => {
  it('is recorded with its code and sentence, and writes nothing', async () => {
    const outcome = await createRunner(
      deps({
        extract: async () => {
          throw new ExtractionError('too_long', '"Town of Ashfall" is about 900,000 tokens.')
        },
      }),
    )(userId, documentId)

    expect(outcome).toMatchObject({
      ok: true,
      run: { status: 'failed', failure: { code: 'too_long' }, claimsCreated: 0 },
    })

    const [row] = await runs()
    expect(row).toMatchObject({
      status: 'failed',
      failureCode: 'too_long',
      failureMessage: '"Town of Ashfall" is about 900,000 tokens.',
    })
    expect(row!.finishedAt).not.toBeNull()
    expect(await issues()).toEqual([])

    const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, documentId))
    expect(doc!.status).toBe('unread')
  })

  it('turns a provider failure into a sentence, and tells Settings', async () => {
    const d = deps({
      extract: async () => {
        throw new ProviderError('rate_limited', 'Quota exceeded for this model.', 429, 45)
      },
    })
    const outcome = await createRunner(d)(userId, documentId)

    expect(outcome.ok && outcome.run.failure).toEqual({
      code: 'rate_limited',
      message:
        'Your provider is rate limiting requests. Try again in 45 seconds. (Quota exceeded for this model.)',
      retryAfterSeconds: 45,
    })
    expect(d.recordHealth).toHaveBeenCalledWith(userId, 'rate_limited', 'Quota exceeded for this model.')
  })

  it('records an unexpected error as internal, and logs it', async () => {
    const logError = vi.fn()
    const boom = new Error('connection reset')
    const outcome = await createRunner(
      deps({
        logError,
        readText: async () => {
          throw boom
        },
      }),
    )(userId, documentId)

    expect(outcome.ok && outcome.run.failure?.code).toBe('internal')
    expect(logError).toHaveBeenCalledWith(boom)
  })
})

describe('refusals', () => {
  it('records nothing for a document that has left the Library', async () => {
    const removed = await insertDocument('drive-2', 'Gone', true)
    const outcome = await createRunner(deps())(userId, removed)
    expect(outcome).toMatchObject({ ok: false, refusal: 'removed' })
    expect(await runs()).toEqual([])
  })

  it('records nothing, and spends nothing, without a provider', async () => {
    const extract = vi.fn()
    const outcome = await createRunner(deps({ credentials: async () => null, extract }))(
      userId,
      documentId,
    )
    expect(outcome).toMatchObject({ ok: false, refusal: 'no_provider' })
    expect(extract).not.toHaveBeenCalled()
    expect(await runs()).toEqual([])
  })

  it('does not find another user’s document', async () => {
    const other = await pg.query<{ id: string }>(
      `insert into users (google_sub, email) values ('sub-2', 'b@example.test') returning id`,
    )
    const outcome = await createRunner(deps())(other.rows[0]!.id, documentId)
    expect(outcome).toMatchObject({ ok: false, refusal: 'not_found' })
  })
})

describe('one run at a time', () => {
  it('refuses a second run while the first is still talking to the model', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const extract = vi.fn(async () => {
      await gate
      return modelRun()
    })
    const run = createRunner(deps({ extract }))

    const first = run(userId, documentId)
    // Let the first run open its row before the second arrives.
    await vi.waitFor(() => expect(extract).toHaveBeenCalledTimes(1))
    const second = await run(userId, documentId)
    release()

    expect(second).toMatchObject({ ok: false, refusal: 'busy' })
    expect((await first).ok).toBe(true)
    expect(extract).toHaveBeenCalledTimes(1)
    expect(await runs()).toHaveLength(1)
  })

  it('opens every run as interrupted, so one that dies is remembered as what it was', async () => {
    const begun = await beginRun(db, userId, documentId, {
      modelRequested: 'test/model',
      driveVersion: 191,
      now: new Date(),
    })
    expect(begun.ok).toBe(true)

    const [row] = await runs()
    expect(row).toMatchObject({ status: 'failed', failureCode: 'interrupted', finishedAt: null })
  })

  it('does not let an abandoned run block the document forever', async () => {
    await beginRun(db, userId, documentId, {
      modelRequested: 'test/model',
      driveVersion: 191,
      now: new Date(Date.now() - RUN_LEASE_MS - 1000),
    })

    const outcome = await createRunner(deps())(userId, documentId)
    expect(outcome.ok).toBe(true)

    const rows = await runs()
    expect(rows.map((r) => r.failureCode ?? r.status).sort()).toEqual(['interrupted', 'succeeded'])
  })
})

describe('the proposals queue', () => {
  const withProposal = (p: ProposedPredicate = tradesWith) =>
    deps({ extract: async () => modelRun({ proposals: [p] }) })

  it('does not pile up when the same document is re-extracted', async () => {
    await createRunner(withProposal())(userId, documentId)
    const again = await createRunner(withProposal())(userId, documentId)

    expect(again.ok && again.run.proposalsFiled).toBe(0)
    expect(await proposals()).toHaveLength(1)
  })

  it('keeps a second document’s sighting of the same gap — that count is the signal', async () => {
    const other = await insertDocument('drive-3', 'The Kaldian Empire')
    await createRunner(withProposal())(userId, documentId)
    await createRunner(withProposal())(userId, other)

    expect((await proposals()).map((p) => p.documentName).sort()).toEqual([
      'The Kaldian Empire',
      'Town of Ashfall',
    ])
  })

  it('decides a name, not a sighting, and does not re-file a decided name', async () => {
    const other = await insertDocument('drive-3', 'The Kaldian Empire')
    await createRunner(withProposal())(userId, documentId)
    await createRunner(withProposal())(userId, other)

    const [first] = await proposals()
    const decided = await decideProposal(db, userId, first!.id, 'rejected')
    expect(decided).toEqual({ name: 'trades_with', updated: 2 })
    expect((await proposals()).every((p) => p.status === 'rejected' && p.decidedAt)).toBe(true)

    const third = await insertDocument('drive-4', 'Salt Roads')
    const again = await createRunner(withProposal())(userId, third)
    expect(again.ok && again.run.proposalsFiled).toBe(0)

    // Reopening clears the decision on every sighting together.
    await decideProposal(db, userId, first!.id, 'open')
    expect((await proposals()).every((p) => p.status === 'open' && p.decidedAt === null)).toBe(true)
  })

  it('will not decide another user’s proposal', async () => {
    await createRunner(withProposal())(userId, documentId)
    const [row] = await proposals()
    const other = await pg.query<{ id: string }>(
      `insert into users (google_sub, email) values ('sub-2', 'b@example.test') returning id`,
    )
    expect(await decideProposal(db, other.rows[0]!.id, row!.id, 'promoted')).toBeNull()
    expect((await proposals())[0]!.status).toBe('open')
  })
})
