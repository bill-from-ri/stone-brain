'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { Route } from 'next'

/**
 * The centre pane every list screen is made of.
 *
 * The Library and Claims had grown two of everything — two column layouts, two
 * bars, two tables, two empty states — that differed only in padding and in
 * which rows they held. They are the same thing: a bar naming what you are
 * looking at with its controls, and a selectable table under it. One
 * implementation means a fix to hover, selection or scrolling lands on both.
 */

export type Column<T> = {
  key: string
  header: React.ReactNode
  /** Passed straight to the `th`; the prototype sizes by percentage and px both. */
  width?: number | string
  align?: 'left' | 'right'
  cell: (row: T) => React.ReactNode
}

export function RecordPane({
  bar,
  flush,
  children,
}: {
  bar: React.ReactNode
  /** For a body that fills the pane itself — the graph, which has no margins. */
  flush?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="sb-pane">
      <div className="sb-pane-bar">{bar}</div>
      <div className={`sb-pane-body${flush ? ' sb-pane-body--flush' : ''}`}>{children}</div>
    </div>
  )
}

/** Pushes the bar's controls to the right, as every bar in the prototype does. */
export function PaneBarSpacer() {
  return <div className="sb-pane-bar-spacer" />
}

export function RecordTable<T>({
  columns,
  rows,
  rowKey,
  selectedKey,
  onSelect,
  dense,
  empty,
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  /** The selected row's key, or null. Selection is a URL concern, not the table's. */
  selectedKey?: string | null
  onSelect?: (row: T) => void
  /** The claim table runs a size smaller than the Library's, as in the prototype. */
  dense?: boolean
  empty: React.ReactNode
}) {
  if (rows.length === 0) return <>{empty}</>

  return (
    <table className={`table sb-table${dense ? ' sb-table--dense' : ''}`}>
      <thead>
        <tr>
          {columns.map((col) => (
            <th
              key={col.key}
              style={{
                ...(col.width !== undefined && { width: col.width }),
                ...(col.align === 'right' && { textAlign: 'right' }),
              }}
            >
              {col.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const key = rowKey(row)
          return (
            <tr
              key={key}
              onClick={onSelect ? () => onSelect(row) : undefined}
              className={key === selectedKey ? 'sb-row--on' : undefined}
            >
              {columns.map((col) => (
                <td key={col.key} style={col.align === 'right' ? { textAlign: 'right' } : undefined}>
                  {col.cell(row)}
                </td>
              ))}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export function EmptyState({
  icon,
  title,
  note,
}: {
  icon?: string
  title: string
  note?: React.ReactNode
}) {
  return (
    <div className="sb-empty">
      {icon && <i className={icon} />}
      <p>{title}</p>
      {note && <p className="sb-faint">{note}</p>}
    </div>
  )
}

/**
 * Selection lives in the query string on both screens, so the mutation helper
 * does too rather than being written out in each table.
 */
export function useParamWriter() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  return (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params)
    mutate(next)
    const qs = next.toString()
    router.replace((qs ? `${pathname}?${qs}` : pathname) as Route, { scroll: false })
  }
}
