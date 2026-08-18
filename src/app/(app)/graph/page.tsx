import { redirect } from 'next/navigation'
import { worldUrl } from '@/lib/world-url'

/** The graph is now a view of /world; see the note on worldUrl. */
export default async function GraphRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  redirect(worldUrl(await searchParams, { view: 'graph' }))
}
