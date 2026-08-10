'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { Route } from 'next'
import { useMemo, useState } from 'react'
import type { DocumentRow } from '@/db/queries/library'

/**
 * The Library's centre pane (prototype lines 228-257).
 *
 * Columns match the prototype exactly, but Claims / Last checked / Conflicts
 * render as em-dashes: Phase 1 has no claim data, and showing zeros would imply
 * "we checked and found none" rather than "we have not looked".
 *
 * Selection lives in the URL rather than component state, so the detail pane can
 * be a server component reading it directly, and so the selection survives the
 * router.refresh() that follows every sync.
 */
export function DocumentTable({
  documents,
  selectedDriveFileId,
  showRemoved,
  removedCount,
  indexing,
}: {
  documents: DocumentRow[]
  selectedDriveFileId: string | null
  showRemoved: boolean
  removedCount: number
  indexing: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [filter, setFilter] = useState('')

  const visible = useMemo(() => {
    const term = filter.trim().toLowerCase()
    if (!term) return documents
    return documents.filter((d) => d.name.toLowerCase().includes(term))
  }, [documents, filter])

  const select = (driveFileId: string) => {
    const next = new URLSearchParams(params)
    next.set('doc', driveFileId)
    router.replace(`${pathname}?${next}` as Route, { scroll: false })
  }

  const toggleRemoved = () => {
    const next = new URLSearchParams(params)
    if (showRemoved) next.delete('removed')
    else next.set('removed', '1')
    next.delete('doc')
    router.replace(`${pathname}?${next}` as Route, { scroll: false })
  }

  return (
    <section className="sb-lib-main">
      <div className="sb-lib-toolbar">
        <div className="seg">
          <button
            type="button"
            className={`seg-opt${showRemoved ? '' : ' seg-opt--on'}`}
            onClick={() => showRemoved && toggleRemoved()}
          >
            All {documents.filter((d) => !d.removedAt).length}
          </button>
          <button
            type="button"
            className={`seg-opt${showRemoved ? ' seg-opt--on' : ''}`}
            onClick={() => !showRemoved && toggleRemoved()}
          >
            Removed {removedCount}
          </button>
        </div>

        <div className="sb-header-spacer" />

        <div className="sb-search" style={{ width: 220 }}>
          <i className="ph ph-magnifying-glass" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name"
            aria-label="Filter documents by name"
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState indexing={indexing} filtered={filter.trim().length > 0} removed={showRemoved} />
      ) : (
        <table className="table sb-doc-table">
          <thead>
            <tr>
              <th style={{ width: '44%' }}>Name</th>
              <th>Claims</th>
              <th>Status</th>
              <th>Last checked</th>
              <th style={{ textAlign: 'right' }}>Conflicts</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((doc) => (
              <tr
                key={doc.id}
                onClick={() => select(doc.driveFileId)}
                className={doc.driveFileId === selectedDriveFileId ? 'sb-row--on' : undefined}
                aria-selected={doc.driveFileId === selectedDriveFileId}
              >
                <td>
                  <div className="sb-doc-name">
                    <i className="ph ph-file-doc" />
                    <span className={doc.removedAt ? 'sb-struck' : undefined}>{doc.name}</span>
                    {doc.removedAt && <span className="tag tag-outline">Removed from folder</span>}
                    {doc.trashed && !doc.removedAt && (
                      <span className="tag tag-outline">In trash</span>
                    )}
                  </div>
                </td>
                <td className="sb-faint">—</td>
                <td>
                  <span className="tag tag-neutral">Unread</span>
                </td>
                <td className="sb-faint">—</td>
                <td className="sb-faint" style={{ textAlign: 'right' }}>
                  —
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function EmptyState({
  indexing,
  filtered,
  removed,
}: {
  indexing: boolean
  filtered: boolean
  removed: boolean
}) {
  if (indexing) {
    return (
      <div className="sb-empty">
        <i className="ph ph-circle-notch" />
        <p>Indexing your folder…</p>
        <p className="sb-faint">Documents appear here as they are found.</p>
      </div>
    )
  }
  if (filtered) {
    return (
      <div className="sb-empty">
        <p>No documents match that filter.</p>
      </div>
    )
  }
  if (removed) {
    return (
      <div className="sb-empty">
        <p>Nothing has been removed from this folder.</p>
        <p className="sb-faint">
          Documents moved out of your root folder are kept here rather than deleted.
        </p>
      </div>
    )
  }
  return (
    <div className="sb-empty">
      <p>No Google Docs in this folder.</p>
      <p className="sb-faint">
        Stone Brain indexes Google Docs only — slides, sheets and uploaded files are skipped.
      </p>
    </div>
  )
}
