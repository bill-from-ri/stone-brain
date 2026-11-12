import 'server-only'
import { and, count, desc, eq, gt, isNotNull, isNull, sql, type SQL } from 'drizzle-orm'
import { db } from '@/db'
import { claims, documents, extractionRuns, folders, type ExtractionRunStatus } from '@/db/schema'

/**
 * The reads behind the Home screen.
 *
 * Every query takes userId first and filters on it, on the same rule as
 * library.ts. Each one is small and independent, so the page runs them in one
 * parallel batch; none of them depends on another's answer.
 */

/* -------------------------------------------------------------- document mix */

export type DocumentMix = {
  /** Documents in the Library now — soft-deleted rows excluded, as everywhere else. */
  total: number
  verified: number
  /** Extracted at least once (`extracted` or `verified`). */
  extracted: number
  /** Never extracted: no `extracted_drive_version` on the row. */
  notExtracted: number
  /** Edited in Drive since the version the current claims were read from. */
  changedSinceExtraction: number
}

/**
 * Staleness is `drive_version` against `extracted_drive_version` and nothing
 * else — the second correction in decisions §6 is why it is not the revision
 * id. A row with no extracted version is "never extracted", not "stale".
 */
const changedSinceExtraction: SQL = and(
  isNotNull(documents.extractedDriveVersion),
  gt(documents.driveVersion, documents.extractedDriveVersion),
)!

const neverExtracted: SQL = isNull(documents.extractedDriveVersion)

/**
 * Extracted, current, and not yet signed off. A changed document is left out
 * here because "re-extract it" is the more useful thing to say about it.
 */
const awaitingVerification: SQL = and(
  eq(documents.status, 'extracted'),
  isNotNull(documents.extractedDriveVersion),
  sql`not (${changedSinceExtraction})`,
)!

/** One pass over the user's documents, every bucket a FILTER on the same scan. */
export async function getDocumentMix(userId: string): Promise<DocumentMix> {
  const [row] = await db
    .select({
      total: count(),
      verified: countWhere(eq(documents.status, 'verified')),
      extracted: countWhere(isNotNull(documents.extractedDriveVersion)),
      notExtracted: countWhere(neverExtracted),
      changedSinceExtraction: countWhere(changedSinceExtraction),
    })
    .from(documents)
    .where(and(eq(documents.userId, userId), isNull(documents.removedAt)))

  return {
    total: row?.total ?? 0,
    verified: row?.verified ?? 0,
    extracted: row?.extracted ?? 0,
    notExtracted: row?.notExtracted ?? 0,
    changedSinceExtraction: row?.changedSinceExtraction ?? 0,
  }
}

function countWhere(condition: SQL) {
  return sql<number>`count(*) filter (where ${condition})`.mapWith(Number)
}

/* ------------------------------------------------------------------- claims */

export async function countClaims(userId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(claims).where(eq(claims.userId, userId))
  return row?.n ?? 0
}

/* -------------------------------------------------- documents worth opening */

export type AttentionReason = 'changed' | 'not_extracted' | 'unverified'

export type AttentionDocument = {
  reason: AttentionReason
  driveFileId: string
  name: string
  /** For the Library link: the folder whose table lists this document. */
  parentDriveFolderId: string | null
  folderName: string | null
  modifiedTime: Date | null
}

/**
 * A few documents in each state Home suggests acting on, most recently edited
 * first — the one you touched last is the likeliest one you mean to come back
 * to. Three small queries rather than one window function: each is an indexed
 * filter with a LIMIT, and the shapes stay readable.
 */
export async function getAttentionDocuments(
  userId: string,
  perReason = 3,
): Promise<AttentionDocument[]> {
  const pick = (reason: AttentionReason, condition: SQL) =>
    db
      .select({
        driveFileId: documents.driveFileId,
        name: documents.name,
        parentDriveFolderId: documents.parentDriveFolderId,
        folderName: folders.name,
        modifiedTime: documents.modifiedTime,
      })
      .from(documents)
      .leftJoin(
        folders,
        and(
          eq(folders.userId, documents.userId),
          eq(folders.driveFolderId, documents.parentDriveFolderId),
        ),
      )
      .where(and(eq(documents.userId, userId), isNull(documents.removedAt), condition))
      .orderBy(sql`${documents.modifiedTime} desc nulls last`, documents.name)
      .limit(perReason)
      .then((rows) => rows.map((r) => ({ reason, ...r })))

  const groups = await Promise.all([
    pick('changed', changedSinceExtraction),
    pick('not_extracted', neverExtracted),
    pick('unverified', awaitingVerification),
  ])
  return groups.flat()
}

/* ---------------------------------------------------------- recent activity */

export type RecentRun = {
  id: string
  status: ExtractionRunStatus
  startedAt: Date
  finishedAt: Date | null
  failureMessage: string | null
  claimsCreated: number
  claimsAlreadyPresent: number
  inversesCreated: number
  documentName: string
  driveFileId: string
  parentDriveFolderId: string | null
  /** The run outlives its document's place in the Library; a link must not. */
  documentRemoved: boolean
}

export async function getRecentRuns(userId: string, limit = 6): Promise<RecentRun[]> {
  const rows = await db
    .select({
      id: extractionRuns.id,
      status: extractionRuns.status,
      startedAt: extractionRuns.startedAt,
      finishedAt: extractionRuns.finishedAt,
      failureMessage: extractionRuns.failureMessage,
      claimsCreated: extractionRuns.claimsCreated,
      claimsAlreadyPresent: extractionRuns.claimsAlreadyPresent,
      inversesCreated: extractionRuns.inversesCreated,
      documentName: documents.name,
      driveFileId: documents.driveFileId,
      parentDriveFolderId: documents.parentDriveFolderId,
      removedAt: documents.removedAt,
    })
    .from(extractionRuns)
    // Inner join with the user on both sides: a run's document_id is a plain
    // FK, and the scope check belongs on every table a query reads.
    .innerJoin(
      documents,
      and(eq(documents.id, extractionRuns.documentId), eq(documents.userId, userId)),
    )
    .where(eq(extractionRuns.userId, userId))
    .orderBy(desc(extractionRuns.startedAt))
    .limit(limit)

  return rows.map(({ removedAt, ...r }) => ({ ...r, documentRemoved: removedAt !== null }))
}
