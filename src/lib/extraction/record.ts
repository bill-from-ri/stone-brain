import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import type { NeonDatabase } from 'drizzle-orm/neon-serverless'
import type * as schema from '@/db/schema'
import { extractionIssues, extractionRuns, predicateProposals, type ProposalStatus } from '@/db/schema'
import type { UnwrittenClaim } from '@/lib/ontology/extraction-write'
import type { ProposedPredicate, Rejection } from '@/lib/ontology/extraction'
import { RUN_LEASE_MS } from './codes'
import { INTERRUPTED_MESSAGE, type RunFailure } from './failure'

/**
 * The history of extraction runs — the write side of implementation plan §6.
 *
 * Every function takes the database handle rather than importing the
 * singleton, for the same reason `writeExtraction` does: so the tests can hand
 * in a real Postgres (PGlite) and assert on what the catalog actually holds.
 */

type Db = NeonDatabase<typeof schema>

/* ---------------------------------------------------------------- starting */

export type BeginResult = { ok: true; runId: string } | { ok: false; startedAt: Date }

/**
 * Open a run, or refuse because one is already open on this document.
 *
 * ## The row is written as a failure, and corrected on success
 *
 * `extraction_runs.status` only admits `succeeded` and `failed`, and that is
 * the right pair: the row a run writes *before* it starts is a failed run
 * called `interrupted`, which `finishRun` overwrites with the real outcome.
 * That ordering is what makes a run that dies mid-flight — a function timeout,
 * a deploy — honest without any cleanup job: it is already recorded as what
 * it turned out to be. A run is "in progress" exactly while its row has no
 * `finished_at` and is younger than `RUN_LEASE_MS`.
 *
 * ## Two clicks, one run
 *
 * The check and the insert run under a transaction-scoped advisory lock keyed
 * on the document, so two requests that arrive together cannot both see "no
 * open run" and both start one — each would spend a provider request (20 a day
 * on the free tier) to write the same claims. The lock is held for two
 * statements and released at commit; nothing slow happens inside it. That is
 * the distinction the note in src/db/index.ts draws: what must never be held
 * across Drive or model I/O is a *session* or a transaction, and the long part
 * of a run is outside this one. The open row is the lease; the lock only
 * serialises taking it.
 */
export async function beginRun(
  db: Db,
  userId: string,
  documentId: string,
  fields: { modelRequested: string; driveVersion: number | null; now: Date },
): Promise<BeginResult> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`extract:${documentId}`}, 0))`,
    )

    const [open] = await tx
      .select({ startedAt: extractionRuns.startedAt })
      .from(extractionRuns)
      .where(
        and(
          eq(extractionRuns.userId, userId),
          eq(extractionRuns.documentId, documentId),
          isNull(extractionRuns.finishedAt),
          gt(extractionRuns.startedAt, new Date(fields.now.getTime() - RUN_LEASE_MS)),
        ),
      )
      .limit(1)

    if (open) return { ok: false as const, startedAt: open.startedAt }

    const [row] = await tx
      .insert(extractionRuns)
      .values({
        userId,
        documentId,
        status: 'failed',
        failureCode: 'interrupted',
        failureMessage: INTERRUPTED_MESSAGE,
        modelRequested: fields.modelRequested,
        driveVersion: fields.driveVersion,
        startedAt: fields.now,
      })
      .returning({ id: extractionRuns.id })

    return { ok: true as const, runId: row!.id }
  })
}

/* --------------------------------------------------------------- finishing */

export type RunRecord = {
  failure: RunFailure | null
  model?: string
  attempts?: number
  responseFormat?: string | null
  promptTokens?: number
  completionTokens?: number
  revisionId?: string | null
  claimsExtracted?: number
  claimsCreated?: number
  claimsAlreadyPresent?: number
  inversesCreated?: number
  sourcesCreated?: number
  entitiesCreated?: number
  rejections?: Rejection[]
  unwritten?: UnwrittenClaim[]
  proposals?: ProposedPredicate[]
}

/**
 * Close a run with what actually happened: the counts, every claim that was
 * lost and why, and the proposals the model filed.
 *
 * One transaction, so the run never reads as finished while its issues are
 * still missing — a run that claims "3 dropped" must be able to show all three.
 */
export async function finishRun(
  db: Db,
  userId: string,
  runId: string,
  document: { id: string; name: string },
  record: RunRecord,
  finishedAt: Date,
): Promise<{ proposalsFiled: number }> {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db

    await t
      .update(extractionRuns)
      .set({
        status: record.failure ? 'failed' : 'succeeded',
        failureCode: record.failure?.code ?? null,
        failureMessage: record.failure?.message ?? null,
        model: record.model ?? null,
        attempts: record.attempts ?? null,
        responseFormat: record.responseFormat ?? null,
        promptTokens: record.promptTokens ?? null,
        completionTokens: record.completionTokens ?? null,
        revisionId: record.revisionId ?? null,
        claimsExtracted: record.claimsExtracted ?? 0,
        claimsCreated: record.claimsCreated ?? 0,
        claimsAlreadyPresent: record.claimsAlreadyPresent ?? 0,
        inversesCreated: record.inversesCreated ?? 0,
        sourcesCreated: record.sourcesCreated ?? 0,
        entitiesCreated: record.entitiesCreated ?? 0,
        finishedAt,
      })
      .where(and(eq(extractionRuns.userId, userId), eq(extractionRuns.id, runId)))

    const issues: (typeof extractionIssues.$inferInsert)[] = [
      ...(record.rejections ?? []).map((r) => ({
        userId,
        runId,
        stage: 'validation' as const,
        code: r.code,
        message: r.message,
        // Verbatim, including whatever made it unparseable — the reason alone
        // is not actionable without the sentence it was about.
        received: r.received ?? null,
        position: r.index,
      })),
      ...(record.unwritten ?? []).map((u) => ({
        userId,
        runId,
        stage: 'write' as const,
        code: u.code,
        message: u.message,
        received: u.claim,
        // `u.index` points into the *validated* claims array, not the model's
        // output, so it would collide with validation positions. Left null, as
        // the schema documents.
        position: null,
      })),
    ]
    if (issues.length > 0) await t.insert(extractionIssues).values(issues)

    const proposalsFiled = await fileProposals(t, userId, runId, document, record.proposals ?? [])
    return { proposalsFiled }
  })
}

/* --------------------------------------------------------------- proposals */

/**
 * Add a run's proposals to the queue, without piling up duplicates.
 *
 * A proposal is kept once per *name and document*: re-extracting a document
 * that wanted `trades_with` does not add a second card, but a second document
 * that wants it does — how many documents hit the same gap is exactly the
 * signal the queue exists to collect (ontology-design.md, "How the vocabulary
 * grows"), and the Settings panel groups them by name.
 *
 * A name that has already been decided either way is not re-filed. A rejected
 * name re-proposed on every extraction would turn the queue into a nag; a
 * promoted one is waiting on a registry edit, after which it is in the
 * vocabulary and `parseProposals` stops it at the door anyway.
 */
export async function fileProposals(
  db: Db,
  userId: string,
  runId: string,
  document: { id: string; name: string },
  proposals: ProposedPredicate[],
): Promise<number> {
  if (proposals.length === 0) return 0

  const existing = await db
    .select({
      name: predicateProposals.name,
      status: predicateProposals.status,
      documentId: predicateProposals.documentId,
    })
    .from(predicateProposals)
    .where(
      and(
        eq(predicateProposals.userId, userId),
        inArray(
          predicateProposals.name,
          proposals.map((p) => p.name),
        ),
      ),
    )

  const decided = new Set(existing.filter((e) => e.status !== 'open').map((e) => e.name))
  const openHere = new Set(
    existing.filter((e) => e.status === 'open' && e.documentId === document.id).map((e) => e.name),
  )

  const rows = proposals
    .filter((p) => !decided.has(p.name) && !openHere.has(p.name))
    .map((p) => ({
      userId,
      runId,
      documentId: document.id,
      documentName: document.name,
      name: p.name,
      description: p.description,
      subjectType: p.subjectType,
      objectType: p.objectType ?? null,
      exampleSubject: p.exampleSubject ?? null,
      exampleObject: p.exampleObject ?? null,
      quote: p.quote ?? null,
      paragraphIndex: p.paragraphIndex ?? null,
    }))

  if (rows.length === 0) return 0
  await db.insert(predicateProposals).values(rows)
  return rows.length
}

/**
 * Promote, reject, or reopen a proposal.
 *
 * A decision is about a **name**, not about one sighting of it: every row with
 * the proposal's name moves together, so "promote `trades_with`" cannot leave
 * the same request from another document still sitting open beside it.
 *
 * Promoting records the decision that the registry should grow. It does not
 * change what the extractor may write — the vocabulary is global and curated,
 * so that is a registry edit and a re-seed (see the doc comment on
 * `predicateProposals`).
 *
 * Returns null for an id this user does not have.
 */
export async function decideProposal(
  db: Db,
  userId: string,
  proposalId: string,
  status: ProposalStatus,
  now: Date = new Date(),
): Promise<{ name: string; updated: number } | null> {
  const [row] = await db
    .select({ name: predicateProposals.name })
    .from(predicateProposals)
    .where(and(eq(predicateProposals.userId, userId), eq(predicateProposals.id, proposalId)))
    .limit(1)
  if (!row) return null

  const updated = await db
    .update(predicateProposals)
    .set({ status, decidedAt: status === 'open' ? null : now })
    .where(and(eq(predicateProposals.userId, userId), eq(predicateProposals.name, row.name)))
    .returning({ id: predicateProposals.id })

  return { name: row.name, updated: updated.length }
}
