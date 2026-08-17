import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRequireReady } from '@/lib/auth/guard'
import { searchDocuments } from '@/db/queries/library'
import { searchEntities } from '@/db/queries/claims'

/**
 * Backs the header's typeahead, over documents *and* entities.
 *
 * Reads Postgres only — never Drive. The mirror is what the Library shows, so
 * searching it is the only way the dropdown and the table can agree, and it
 * keeps a keystroke-rate endpoint off anyone's Drive quota.
 *
 * Entities come back through the same alias-aware path the entity matcher uses,
 * so "Nethros" finds Enua here exactly as it would during extraction. The two
 * kinds are returned as separate lists rather than one interleaved one: they
 * navigate to different places and carry different subtitles, and merging them
 * would only push the distinction into the client.
 */

const querySchema = z.object({
  q: z.string().min(1).max(128),
})

export type SearchResponse = {
  documents: {
    driveFileId: string
    name: string
    /** Path relative to the library root, e.g. 'History/Ancient'. Empty at root. */
    path: string
    /** Null when the parent folder is outside the mirror — not navigable. */
    folderId: string | null
  }[]
  entities: {
    id: string
    name: string
    /** Display form of the type, e.g. 'Settlement'. From entity_types.label. */
    typeLabel: string
    /** Set when the match was on an alias, so the row can say why it is here. */
    matchedVariant: string | null
  }[]
}

export async function GET(request: NextRequest) {
  const guard = await apiRequireReady()
  if (!guard.ok) return guard.response

  const empty: SearchResponse = { documents: [], entities: [] }

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams))
  if (!parsed.success) return NextResponse.json(empty)

  const query = parsed.data.q.trim()

  // userId comes from the session. Never from the request.
  const [docs, ents] = await Promise.all([
    searchDocuments(guard.session.user.id, query),
    searchEntities(guard.session.user.id, query),
  ])

  const rootName = guard.session.rootFolderName

  return NextResponse.json({
    documents: docs.map((hit) => ({
      driveFileId: hit.driveFileId,
      name: hit.name,
      path: relativePath(hit.folderPath, rootName),
      folderId: hit.parentDriveFolderId,
    })),
    entities: ents.map((hit) => ({
      id: hit.id,
      name: hit.name,
      typeLabel: hit.entityTypeLabel,
      matchedVariant: hit.matchedVariant,
    })),
  } satisfies SearchResponse)
}

/**
 * folders.path is absolute from the root folder ('/Nevlos/History'). The
 * dropdown wants it relative to the library root, since every row shares that
 * prefix and repeating it tells the reader nothing.
 */
function relativePath(folderPath: string | null, rootName: string | null): string {
  const parts = (folderPath ?? '').split('/').filter(Boolean)
  if (parts.length && rootName && parts[0] === rootName) parts.shift()
  return parts.join('/')
}
