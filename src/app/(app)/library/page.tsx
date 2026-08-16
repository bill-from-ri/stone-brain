import { redirect } from 'next/navigation'
import type { Route } from 'next'
import { requireReady } from '@/lib/auth/guard'

export const dynamic = 'force-dynamic'

/**
 * /library is an alias for the root folder. The canonical URL always names a
 * folder, so every Library view is linkable and reloadable.
 */
export default async function LibraryIndexPage() {
  const session = await requireReady()
  redirect(`/library/${session.rootDriveFolderId}` as Route)
}
