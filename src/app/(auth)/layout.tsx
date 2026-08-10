import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { setupStateOf } from '@/lib/auth/guard'

/**
 * The inverse of the app gate: a fully set-up user has no business on the
 * connect screen or the folder picker, so bounce them home.
 *
 * `needs_root` deliberately falls through — /setup/folder lives in this group
 * precisely because it must render for a signed-in user who has no root yet.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const state = setupStateOf(await getSession())
  if (state === 'ready' || state === 'reconnect') redirect('/')

  return <>{children}</>
}
