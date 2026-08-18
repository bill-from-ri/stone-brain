import type { Route } from 'next'

/**
 * A /world URL carrying a page's existing query string.
 *
 * Used by the /claims and /graph redirects, which stay alive rather than
 * 404ing: both were linked from the nav rail and from anything anyone
 * bookmarked, and a link to a particular entity or claim should still land on
 * it after the two screens merged.
 */
export function worldUrl(
  params: Record<string, string | string[] | undefined>,
  extra?: Record<string, string>,
): Route {
  const next = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') next.set(key, value)
  }
  for (const [key, value] of Object.entries(extra ?? {})) next.set(key, value)
  const qs = next.toString()
  return (qs ? `/world?${qs}` : '/world') as Route
}
