'use client'

import { useHydrated } from './useHydrated'

/**
 * A time of day, in the viewer's own timezone.
 *
 * The server cannot know the viewer's timezone, and a server component that
 * formats "14:05" is formatting it in whatever zone the host runs in — UTC in
 * production, which is nobody's wall clock. `suppressHydrationWarning` does
 * not help: it silences the mismatch but keeps the server's text. So the
 * server and the hydrating pass both say the time in UTC, labelled as such,
 * and the browser re-renders it in local time straight after (`useHydrated`).
 *
 * Calendar dates alone do not need this: the Library's day columns are UTC
 * calendar dates on purpose, the same in both renders.
 */
export function LocalTime({
  value,
  options,
}: {
  /** An ISO string, or a Date from a server component (Dates cross the boundary intact). */
  value: string | Date
  options: Intl.DateTimeFormatOptions
}) {
  const hydrated = useHydrated()
  const date = new Date(value)
  const text = hydrated
    ? new Intl.DateTimeFormat('en-GB', options).format(date)
    : `${new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(date)} UTC`

  return <time dateTime={date.toISOString()}>{text}</time>
}
