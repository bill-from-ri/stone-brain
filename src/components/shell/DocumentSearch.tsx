'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { Route } from 'next'
import { useEffect, useState } from 'react'

/**
 * The header's search field (prototype line 94-97).
 *
 * The prototype's placeholder promises claims and entities; in Phase 1 there are
 * none, so it filters documents by name and says so. Debounced into the URL so
 * the filtered view is linkable and survives the sync poller's refresh.
 *
 * It lives in the header on every screen but Settings, so off the Library it has
 * to mean something: typing there takes you to the Library carrying the query,
 * rather than filtering a screen with no documents on it.
 */
export function DocumentSearch() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [value, setValue] = useState(params.get('q') ?? '')

  useEffect(() => {
    const timer = setTimeout(() => {
      const q = value.trim()

      if (!pathname.startsWith('/library')) {
        // Nothing typed yet — don't yank someone off Home the moment they focus
        // the field and delete a character.
        if (q) router.push(`/library?q=${encodeURIComponent(q)}` as Route)
        return
      }

      const next = new URLSearchParams(params)
      if (q) next.set('q', q)
      else next.delete('q')
      if (next.toString() === params.toString()) return
      next.delete('doc')
      router.replace(`${pathname}?${next}` as Route, { scroll: false })
    }, 250)
    return () => clearTimeout(timer)
  }, [value, params, pathname, router])

  return (
    <label className="sb-search">
      <i className="ph ph-magnifying-glass" />
      <input
        className="input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search documents"
        aria-label="Search documents by name"
      />
    </label>
  )
}
