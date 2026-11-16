import { and, eq } from 'drizzle-orm'
import type { NeonDatabase } from 'drizzle-orm/neon-serverless'
import type * as schema from '@/db/schema'
import { documents, type ProviderHealth } from '@/db/schema'
import type { DocumentText } from '@/lib/documents/text'
import type { ProviderCredentials } from '@/lib/llm/client'
import { ProviderError } from '@/lib/llm/errors'
import type { ExtractionInput, ExtractionRun as ModelRun } from '@/lib/llm/extract'
import type { CompiledOntology } from '@/lib/ontology/extraction'
import { loadExistingClaims } from '@/lib/ontology/existing-claims'
import type { writeExtraction } from '@/lib/ontology/extraction-write'
import type { RunRefusal, RunSummary } from './codes'
import { describeFailure } from './failure'
import { beginRun, finishRun, type RunRecord } from './record'

/**
 * One document, start to finish, with a record of what happened — the product
 * version of what `scripts/extract-document.ts` used to do by hand.
 *
 * The steps are the ones §2–§4 built: read the document (§2), ask the model
 * (§4), write what survived (§3). A re-extraction is the same run with one
 * more input — the claims the document already holds, which the model may
 * retract by name (see src/lib/ontology/existing-claims.ts). What this adds is that every attempt leaves
 * a row behind, *including the ones that fail*, with every claim that was
 * dropped and why (§6). Without that, a document that extracted badly is
 * indistinguishable from one that extracted well.
 *
 * ## Why the collaborators are injected
 *
 * Everything that reaches outside the process — Drive, the provider, the
 * credential store — arrives through `RunnerDeps`, so the tests can run the
 * real recording logic and the real write path against PGlite with the model
 * stubbed, and spend no requests from a 20-a-day free tier doing it. `run.ts`
 * is the thin module that wires in the real ones.
 */

type Db = NeonDatabase<typeof schema>

export type RunnerDeps = {
  db: Db
  credentials: (userId: string) => Promise<ProviderCredentials | null>
  readText: (userId: string, driveFileId: string) => Promise<DocumentText>
  extract: (creds: ProviderCredentials, input: ExtractionInput) => Promise<ModelRun>
  write: typeof writeExtraction
  ontology: () => CompiledOntology
  recordHealth: (userId: string, health: ProviderHealth, detail: string | null) => Promise<void>
  now?: () => Date
  /** For failures nobody designed — the ones recorded as `internal`. */
  logError?: (err: unknown) => void
}

export type RunOutcome =
  | { ok: true; run: RunSummary }
  /** Refused before anything started. No run is recorded and no request spent. */
  | { ok: false; refusal: RunRefusal; message: string; startedAt?: string }

const REFUSAL_COPY: Record<Exclude<RunRefusal, 'busy'>, string> = {
  not_found: 'No such document.',
  removed: 'This document is no longer in your Drive folder, so there is nothing to read.',
  no_provider: 'No inference provider is configured. Add one in Settings to extract claims.',
}

export function createRunner(deps: RunnerDeps) {
  const now = deps.now ?? (() => new Date())
  const logError = deps.logError ?? ((err: unknown) => console.error('[extraction]', err))

  return async function runExtraction(userId: string, documentId: string): Promise<RunOutcome> {
    const [doc] = await deps.db
      .select({
        id: documents.id,
        name: documents.name,
        driveFileId: documents.driveFileId,
        driveVersion: documents.driveVersion,
        removedAt: documents.removedAt,
        trashed: documents.trashed,
      })
      .from(documents)
      .where(and(eq(documents.userId, userId), eq(documents.id, documentId)))
      .limit(1)

    if (!doc) return refuse('not_found')
    // A removed document's row survives for its claims' sake (ADR §7a), but
    // there is no text behind it any more; reading it would 404 at Drive after
    // a run row had already been opened for it.
    if (doc.removedAt || doc.trashed) return refuse('removed')

    // Checked before a run is opened: "you have no provider" is a setup state
    // with a fix in Settings, not an extraction that failed.
    const creds = await deps.credentials(userId)
    if (!creds) return refuse('no_provider')

    const started = now()
    const begun = await beginRun(deps.db, userId, doc.id, {
      modelRequested: creds.modelId,
      driveVersion: doc.driveVersion,
      now: started,
    })
    if (!begun.ok) {
      return {
        ok: false,
        refusal: 'busy',
        message: 'This document is already being extracted. Its result will appear here when it lands.',
        startedAt: begun.startedAt.toISOString(),
      }
    }

    let model: ModelRun | undefined
    let record: RunRecord

    try {
      const text = await deps.readText(userId, doc.driveFileId)
      // Empty on a first extraction, which then sends the prompt it always has.
      const existing = await loadExistingClaims(deps.db, userId, doc.id, text.paragraphs)

      model = await deps.extract(creds, {
        documentName: doc.name,
        paragraphs: text.paragraphs,
        ontology: deps.ontology(),
        existingClaims: existing,
      })

      const written = await deps.write(
        deps.db,
        userId,
        model.claims,
        {
          documentId: doc.id,
          documentName: doc.name,
          headRevisionId: text.headRevisionId,
          // The version the sync last saw, which is the one the export read —
          // and the value staleness is later measured against (ADR §6).
          driveVersion: doc.driveVersion,
          model: model.model,
        },
        // Whenever there was something to show, even with nothing retracted:
        // kept citations whose quotes moved are re-pointed either way.
        existing.length > 0 ? { existing, retractions: model.retractions ?? [] } : undefined,
      )

      record = {
        ...modelFields(model),
        failure: null,
        revisionId: text.headRevisionId,
        claimsCreated: written.claimsCreated,
        claimsAlreadyPresent: written.claimsAlreadyPresent,
        inversesCreated: written.inversesCreated,
        sourcesCreated: written.sourcesCreated,
        entitiesCreated: written.entitiesCreated.length,
        claimsRetracted: written.claimsRetracted,
        claimsKept: existing.length - written.claimsRetracted,
        rejections: model.rejections,
        unwritten: written.unwritten,
        proposals: model.proposals,
        retractions: written.retractions,
      }

      // A call that worked is the best health check there is, and clears a
      // stale "rate limited" from the Settings panel without a re-probe.
      await deps.recordHealth(userId, 'ok', null).catch(() => {})
    } catch (err) {
      const failure = describeFailure(err)
      if (failure.code === 'internal') logError(err)

      // The provider named its own state; Settings should show it too, rather
      // than a "Connected" that the last real call just disproved (ADR §11).
      if (err instanceof ProviderError) {
        await deps.recordHealth(userId, err.reason, err.detail).catch(() => {})
      }

      // A failed run writes nothing to the graph — `writeExtraction` is one
      // transaction — so its row keeps only what the model reported, if it got
      // that far, and none of its issues or proposals.
      record = { ...(model ? modelFields(model) : {}), failure }
    }

    const finished = now()
    const { proposalsFiled } = await finishRun(
      deps.db,
      userId,
      begun.runId,
      { id: doc.id, name: doc.name },
      record,
      finished,
    )

    return {
      ok: true,
      run: {
        runId: begun.runId,
        documentId: doc.id,
        status: record.failure ? 'failed' : 'succeeded',
        failure: record.failure,
        model: record.model ?? null,
        attempts: record.attempts ?? null,
        claimsExtracted: record.claimsExtracted ?? 0,
        claimsCreated: record.claimsCreated ?? 0,
        claimsAlreadyPresent: record.claimsAlreadyPresent ?? 0,
        inversesCreated: record.inversesCreated ?? 0,
        entitiesCreated: record.entitiesCreated ?? 0,
        claimsRetracted: record.claimsRetracted ?? 0,
        claimsKept: record.claimsKept ?? 0,
        dropped: (record.rejections?.length ?? 0) + (record.unwritten?.length ?? 0),
        proposalsFiled,
        durationMs: finished.getTime() - started.getTime(),
      },
    }
  }
}

function refuse(refusal: Exclude<RunRefusal, 'busy'>): RunOutcome {
  return { ok: false, refusal, message: REFUSAL_COPY[refusal] }
}

function modelFields(model: ModelRun): RunRecord {
  return {
    failure: null,
    model: model.model,
    attempts: model.attempts,
    responseFormat: model.responseFormat,
    promptTokens: model.usage.promptTokens,
    completionTokens: model.usage.completionTokens,
    claimsExtracted: model.claims.length,
  }
}
