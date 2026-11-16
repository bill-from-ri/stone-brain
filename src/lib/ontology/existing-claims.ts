import { and, asc, eq, inArray } from 'drizzle-orm'
import type { NeonDatabase } from 'drizzle-orm/neon-serverless'
import type * as schema from '@/db/schema'
import { claimSources, claims, entities, type Canonicity, type Provenance } from '@/db/schema'
import type { Paragraph } from '@/lib/drive/markdown'
import { inverseOf } from './inverse'

/**
 * What a document already holds, read back for a re-extraction.
 *
 * A re-extraction is the same run as a first one — the whole current document,
 * the same rules — with one extra input: the claims this document is already a
 * source for. The model is told those hold unless it says otherwise, so a
 * claim that still holds is simply not re-emitted, and an unchanged paragraph
 * has nothing to drift into. What it does say otherwise about comes back as a
 * retraction (see `applyRevision` in extraction-write.ts).
 *
 * Two things are done here, deterministically, so the model does not have to:
 *
 *   - **One direction per fact.** Inverses are written by the write path, not
 *     the model (§5), so both directions of a relationship cite the document.
 *     Showing the model both would contradict rule 4 of the prompt and invite
 *     it to retract one direction and keep the other. Each pair is shown once
 *     and carries its partner, which a retraction takes with it.
 *   - **Where each quote is now.** Every citation's quote is looked for in the
 *     current text. A quote that is nowhere is the "what changed" signal a
 *     stored diff would otherwise give, at no storage cost; a quote that has
 *     moved is re-pointed at its new paragraph by the write path, so the
 *     paragraph numbers the next run sees are true.
 */

type Db = NeonDatabase<typeof schema>

export type ExistingSource = {
  id: string
  paragraphIndex: number | null
  quote: string | null
  /**
   * The paragraph the quote is in *now*: its old one if it is still there,
   * otherwise the first that contains it. Null when the current text no longer
   * contains the quote anywhere.
   */
  foundAt: number | null
}

/** One stored claim row this document cites. */
export type ExistingMember = {
  id: string
  canonicity: Canonicity
  createdBy: Provenance
  sources: ExistingSource[]
}

/** A fact as the model is shown it: one direction, with its partner in tow. */
export type ExistingClaim = {
  /** `c1`, `c2`, … — what the model names in `retract`. Unique within a run. */
  handle: string
  subjectName: string
  subjectType: string
  predicate: string
  objectName: string | null
  objectType: string | null
  /** The attribute value as text, for display. Null for a relationship. */
  value: string | null
  startTime: string | null
  endTime: string | null
  /** The claim shown first, then its inverse when this document cites that too. */
  members: ExistingMember[]
}

export async function loadExistingClaims(
  db: Db,
  userId: string,
  documentId: string,
  paragraphs: Paragraph[],
): Promise<ExistingClaim[]> {
  const cited = await db
    .selectDistinct({ claimId: claimSources.claimId })
    .from(claimSources)
    .where(and(eq(claimSources.userId, userId), eq(claimSources.documentId, documentId)))

  if (cited.length === 0) return []
  const ids = cited.map((c) => c.claimId)

  const rows = await db
    .select({
      id: claims.id,
      subjectId: claims.subjectId,
      subjectType: claims.subjectType,
      predicate: claims.predicate,
      objectId: claims.objectId,
      objectType: claims.objectType,
      valueInt: claims.valueInt,
      valueFloat: claims.valueFloat,
      valueString: claims.valueString,
      valueTime: claims.valueTime,
      startTime: claims.startTime,
      endTime: claims.endTime,
      canonicity: claims.canonicity,
      createdBy: claims.createdBy,
    })
    .from(claims)
    .where(and(eq(claims.userId, userId), inArray(claims.id, ids)))
    // A fixed order, so handles and the direction shown are stable across runs
    // that add nothing. Which direction of a pair is shown is otherwise
    // arbitrary: both are written in one statement and nothing records which
    // the document stated. Either reads as the same fact.
    .orderBy(asc(claims.createdAt), asc(claims.id))

  const entityIds = [...new Set(rows.flatMap((r) => (r.objectId ? [r.subjectId, r.objectId] : [r.subjectId])))]
  const names = new Map(
    (
      await db
        .select({ id: entities.id, name: entities.name })
        .from(entities)
        .where(and(eq(entities.userId, userId), inArray(entities.id, entityIds)))
    ).map((e) => [e.id, e.name]),
  )

  const sources = await db
    .select({
      id: claimSources.id,
      claimId: claimSources.claimId,
      paragraphIndex: claimSources.paragraphIndex,
      quote: claimSources.quote,
    })
    .from(claimSources)
    .where(
      and(
        eq(claimSources.userId, userId),
        eq(claimSources.documentId, documentId),
        inArray(claimSources.claimId, ids),
      ),
    )
    .orderBy(asc(claimSources.paragraphIndex))

  const locate = quoteLocator(paragraphs)
  const sourcesOf = new Map<string, ExistingSource[]>()
  for (const s of sources) {
    const list = sourcesOf.get(s.claimId) ?? []
    list.push({
      id: s.id,
      paragraphIndex: s.paragraphIndex,
      quote: s.quote,
      foundAt: locate(s.quote, s.paragraphIndex),
    })
    sourcesOf.set(s.claimId, list)
  }

  const byIdentity = new Map(rows.map((r) => [identity(r), r]))
  const paired = new Set<string>()
  const out: ExistingClaim[] = []

  for (const row of rows) {
    const alreadyShown = paired.has(row.id)
    if (alreadyShown) continue
    paired.add(row.id)

    const members: ExistingMember[] = [member(row, sourcesOf)]

    const inverse = row.objectId
      ? inverseOf({ ...row, userId, objectId: row.objectId, objectType: row.objectType })
      : null
    const partner = inverse ? byIdentity.get(identity(inverse)) : undefined
    if (partner && !paired.has(partner.id)) {
      paired.add(partner.id)
      members.push(member(partner, sourcesOf))
    }

    out.push({
      handle: `c${out.length + 1}`,
      subjectName: names.get(row.subjectId) ?? '(unknown)',
      subjectType: row.subjectType,
      predicate: row.predicate,
      objectName: row.objectId ? (names.get(row.objectId) ?? '(unknown)') : null,
      objectType: row.objectType,
      value: displayValue(row),
      startTime: row.startTime,
      endTime: row.endTime,
      members,
    })
  }

  return out
}

function member(
  row: { id: string; canonicity: Canonicity; createdBy: Provenance },
  sourcesOf: Map<string, ExistingSource[]>,
): ExistingMember {
  return {
    id: row.id,
    canonicity: row.canonicity,
    createdBy: row.createdBy,
    sources: sourcesOf.get(row.id) ?? [],
  }
}

/** The fields an inverse is matched on: swapped ends, inverse predicate, same dates. */
function identity(row: {
  subjectId: string
  predicate: string
  objectId?: string | null
  startTime?: string | null
  endTime?: string | null
}): string {
  return [row.subjectId, row.predicate, row.objectId ?? '', row.startTime ?? '', row.endTime ?? ''].join(
    '\u0000',
  )
}

function displayValue(row: {
  valueInt: number | null
  valueFloat: number | null
  valueString: string | null
  valueTime: string | null
}): string | null {
  if (row.valueString !== null) return row.valueString
  if (row.valueTime !== null) return row.valueTime
  if (row.valueInt !== null) return String(row.valueInt)
  if (row.valueFloat !== null) return String(row.valueFloat)
  return null
}

/** Whitespace-insensitive, since an edit that only reflows a line is no edit. */
const squash = (text: string) => text.replace(/\s+/g, ' ').trim()

/**
 * Find a quote in the current paragraphs, preferring the one it was cited
 * from — a quote that occurs twice should not jump to the first occurrence
 * when its own paragraph still has it.
 */
function quoteLocator(paragraphs: Paragraph[]) {
  const texts = paragraphs.map((p) => ({ index: p.index, text: squash(p.text) }))
  const byIndex = new Map(texts.map((t) => [t.index, t.text]))

  return (quote: string | null, cited: number | null): number | null => {
    if (!quote) return null
    const needle = squash(quote)
    if (needle === '') return null
    if (cited !== null && byIndex.get(cited)?.includes(needle)) return cited
    return texts.find((t) => t.text.includes(needle))?.index ?? null
  }
}
