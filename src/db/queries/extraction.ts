import 'server-only'
import { aliasedTable, and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  claimRetractions,
  claimSources,
  claims,
  entities,
  extractionIssues,
  extractionRuns,
  predicateProposals,
  predicates,
  type ExtractionIssueStage,
  type ProposalStatus,
  type RetractionOutcome,
} from '@/db/schema'
import { RUN_LEASE_MS } from '@/lib/extraction/codes'

/**
 * The read side of extraction history (implementation plan §6, §8): what the
 * Library shows about a document's runs, and what Settings shows of the
 * vocabulary proposals queue.
 *
 * Same rule as library.ts: every query takes userId first and filters on it.
 */

/* --------------------------------------------------------------------- runs */

export type RunIssue = {
  id: string
  stage: ExtractionIssueStage
  code: string
  message: string
  received: unknown
}

export type RunRetraction = {
  id: string
  outcome: RetractionOutcome
  reason: string
  detail: string | null
  /** The `RetractedClaim` snapshot from extraction-write.ts. */
  claim: unknown
}

export type FinishedRun = {
  id: string
  status: 'succeeded' | 'failed'
  failureCode: string | null
  failureMessage: string | null
  model: string | null
  startedAt: Date
  finishedAt: Date | null
  claimsExtracted: number
  claimsCreated: number
  claimsAlreadyPresent: number
  inversesCreated: number
  entitiesCreated: number
  claimsKept: number
  claimsRetracted: number
  issues: RunIssue[]
  retractions: RunRetraction[]
}

export type DocumentRuns = {
  /** The most recent run that is over — succeeded, failed, or interrupted. */
  latest: FinishedRun | null
  /** Set while a run is in flight on this document (another tab, another click). */
  runningSince: Date | null
}

/**
 * The document's last completed run with every claim it dropped, plus whether
 * one is running now.
 *
 * "Completed" includes a run that was interrupted: its row has no
 * `finished_at`, but once it is older than the lease it is over, and it is
 * reported as the failure it was (see `beginRun`).
 */
export async function getDocumentRuns(userId: string, documentId: string): Promise<DocumentRuns> {
  const leaseStart = new Date(Date.now() - RUN_LEASE_MS)

  const recent = await db
    .select({
      id: extractionRuns.id,
      status: extractionRuns.status,
      failureCode: extractionRuns.failureCode,
      failureMessage: extractionRuns.failureMessage,
      model: extractionRuns.model,
      startedAt: extractionRuns.startedAt,
      finishedAt: extractionRuns.finishedAt,
      claimsExtracted: extractionRuns.claimsExtracted,
      claimsCreated: extractionRuns.claimsCreated,
      claimsAlreadyPresent: extractionRuns.claimsAlreadyPresent,
      inversesCreated: extractionRuns.inversesCreated,
      entitiesCreated: extractionRuns.entitiesCreated,
      claimsKept: extractionRuns.claimsKept,
      claimsRetracted: extractionRuns.claimsRetracted,
    })
    .from(extractionRuns)
    .where(and(eq(extractionRuns.userId, userId), eq(extractionRuns.documentId, documentId)))
    .orderBy(desc(extractionRuns.startedAt))
    // A running row can only be the newest, and the last finished one is right
    // behind it; two rows answer both questions.
    .limit(2)

  const isRunning = (r: (typeof recent)[number]) => r.finishedAt === null && r.startedAt > leaseStart
  const running = recent.find(isRunning) ?? null
  const latest = recent.find((r) => !isRunning(r)) ?? null

  if (!latest) return { latest: null, runningSince: running?.startedAt ?? null }

  const issues = await db
    .select({
      id: extractionIssues.id,
      stage: extractionIssues.stage,
      code: extractionIssues.code,
      message: extractionIssues.message,
      received: extractionIssues.received,
    })
    .from(extractionIssues)
    .where(and(eq(extractionIssues.userId, userId), eq(extractionIssues.runId, latest.id)))
    // Validation first, in the order the model emitted them; then the write
    // path's refusals, which carry no position.
    .orderBy(asc(extractionIssues.stage), asc(extractionIssues.position), asc(extractionIssues.createdAt))

  const retractions = await db
    .select({
      id: claimRetractions.id,
      outcome: claimRetractions.outcome,
      reason: claimRetractions.reason,
      detail: claimRetractions.detail,
      claim: claimRetractions.claim,
    })
    .from(claimRetractions)
    .where(and(eq(claimRetractions.userId, userId), eq(claimRetractions.runId, latest.id)))
    .orderBy(asc(claimRetractions.createdAt))

  return { latest: { ...latest, issues, retractions }, runningSince: running?.startedAt ?? null }
}

/* ------------------------------------------------------------------- claims */

export type DocumentClaim = {
  id: string
  subject: string
  /** The predicate's label ("Ruled by"), not its machine name. */
  predicate: string
  object: string | null
}

/**
 * A short list of the claims this document is a source for, for the detail
 * pane. The total is `DocumentRow.claimCount`; this is a taste of it, newest
 * first so a fresh extraction's claims are what you see.
 */
export async function getDocumentClaims(
  userId: string,
  documentId: string,
  limit = 6,
): Promise<DocumentClaim[]> {
  const subject = aliasedTable(entities, 'subject')
  const object = aliasedTable(entities, 'object')

  const cited = db
    .selectDistinct({ claimId: claimSources.claimId })
    .from(claimSources)
    .where(and(eq(claimSources.userId, userId), eq(claimSources.documentId, documentId)))

  return db
    .select({
      id: claims.id,
      subject: subject.name,
      predicate: predicates.label,
      object: sql<string | null>`coalesce(
        ${object.name},
        ${claims.valueString},
        ${claims.valueTime},
        ${claims.valueInt}::text,
        ${claims.valueFloat}::text
      )`,
    })
    .from(claims)
    .innerJoin(subject, eq(subject.id, claims.subjectId))
    .leftJoin(object, eq(object.id, claims.objectId))
    .innerJoin(predicates, eq(predicates.name, claims.predicate))
    .where(and(eq(claims.userId, userId), inArray(claims.id, cited)))
    .orderBy(desc(claims.createdAt), asc(subject.name))
    .limit(limit)
}

/* ---------------------------------------------------------------- proposals */

export type ProposalSighting = {
  id: string
  documentId: string | null
  documentName: string | null
  quote: string | null
  paragraphIndex: number | null
  exampleSubject: string | null
  exampleObject: string | null
  createdAt: Date
}

/**
 * One proposed predicate and every document that asked for it.
 *
 * Grouped by name because that is the unit a decision is made on (see
 * `decideProposal`), and because "four documents wanted this" is the signal
 * the queue exists to surface. The description and signature shown are the
 * first sighting's; later ones may phrase it differently, and their quotes are
 * listed in full.
 */
export type ProposalGroup = {
  /** The id a decision is sent to — any sighting's id decides the whole name. */
  id: string
  name: string
  status: ProposalStatus
  description: string
  subjectType: string | null
  objectType: string | null
  decidedAt: Date | null
  sightings: ProposalSighting[]
}

export async function getProposalQueue(
  userId: string,
): Promise<{ open: ProposalGroup[]; decided: ProposalGroup[] }> {
  const rows = await db
    .select()
    .from(predicateProposals)
    .where(eq(predicateProposals.userId, userId))
    .orderBy(asc(predicateProposals.createdAt))

  const groups = new Map<string, ProposalGroup>()
  for (const row of rows) {
    let group = groups.get(row.name)
    if (!group) {
      group = {
        id: row.id,
        name: row.name,
        status: row.status,
        description: row.description,
        subjectType: row.subjectType,
        objectType: row.objectType,
        decidedAt: row.decidedAt,
        sightings: [],
      }
      groups.set(row.name, group)
    }
    group.sightings.push({
      id: row.id,
      documentId: row.documentId,
      documentName: row.documentName,
      quote: row.quote,
      paragraphIndex: row.paragraphIndex,
      exampleSubject: row.exampleSubject,
      exampleObject: row.exampleObject,
      createdAt: row.createdAt,
    })
  }

  const all = [...groups.values()]
  return {
    // Most-wanted first: the gap the most documents hit is the one most worth
    // a registry edit.
    open: all
      .filter((g) => g.status === 'open')
      .sort((a, b) => b.sightings.length - a.sightings.length || a.name.localeCompare(b.name)),
    decided: all
      .filter((g) => g.status !== 'open')
      .sort((a, b) => (b.decidedAt?.getTime() ?? 0) - (a.decidedAt?.getTime() ?? 0)),
  }
}

export type DocumentProposal = {
  id: string
  name: string
  description: string
  quote: string | null
}

/** Open proposals this document raised, for its detail pane. */
export async function getDocumentProposals(
  userId: string,
  documentId: string,
): Promise<DocumentProposal[]> {
  return db
    .select({
      id: predicateProposals.id,
      name: predicateProposals.name,
      description: predicateProposals.description,
      quote: predicateProposals.quote,
    })
    .from(predicateProposals)
    .where(
      and(
        eq(predicateProposals.userId, userId),
        eq(predicateProposals.documentId, documentId),
        eq(predicateProposals.status, 'open'),
      ),
    )
    .orderBy(asc(predicateProposals.name))
}
