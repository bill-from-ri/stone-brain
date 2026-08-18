import { redirect } from 'next/navigation'
import { worldUrl } from '@/lib/world-url'

/** Claims and Graph became one screen; see the note on worldUrl. */
export default async function ClaimsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  redirect(worldUrl(await searchParams))
}
