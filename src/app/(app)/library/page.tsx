import { redirect } from 'next/navigation'
import type { Route } from 'next'
import { requireReady } from '@/lib/auth/guard'

export const dynamic = 'force-dynamic'

/**
 * /library is an alias for the root folder. The canonical URL always names a
 * folder, so every Library view is linkable and reloadable.
 */
export default async function LibraryIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const session = await requireReady()
  // The header's search field targets /library from other screens, so the query
  // has to survive the hop to the canonical folder URL.
  const { q } = await searchParams
  const query = (q ?? '').trim()
  const suffix = query ? `?q=${encodeURIComponent(query)}` : ''
  redirect(`/library/${session.rootDriveFolderId}${suffix}` as Route)
}
