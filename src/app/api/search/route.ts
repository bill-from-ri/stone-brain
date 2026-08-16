import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRequireReady } from '@/lib/auth/guard'
import { searchDocuments } from '@/db/queries/library'

/**
 * Backs the header's typeahead.
 *
 * Reads the Postgres mirror only — never Drive. The mirror is what the Library
 * shows, so searching it is the only way the dropdown and the table can agree,
 * and it keeps a keystroke-rate endpoint off anyone's Drive quota.
 */

const querySchema = z.object({
  q: z.string().min(1).max(128),
})

export type SearchResponse = {
  hits: {
    driveFileId: string
    name: string
    /** Path relative to the library root, e.g. 'History/Ancient'. Empty at root. */
    path: string
    /** Null when the parent folder is outside the mirror — not navigable. */
    folderId: string | null
  }[]
}

export async function GET(request: NextRequest) {
  const guard = await apiRequireReady()
  if (!guard.ok) return guard.response

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams))
  if (!parsed.success) return NextResponse.json({ hits: [] } satisfies SearchResponse)

  // userId comes from the session. Never from the request.
  const hits = await searchDocuments(guard.session.user.id, parsed.data.q.trim())

  const rootName = guard.session.rootFolderName

  return NextResponse.json({
    hits: hits.map((hit) => ({
      driveFileId: hit.driveFileId,
      name: hit.name,
      path: relativePath(hit.folderPath, rootName),
      folderId: hit.parentDriveFolderId,
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
