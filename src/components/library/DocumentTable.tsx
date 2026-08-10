'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { Route } from 'next'
import type { DocumentRow } from '@/db/queries/library'

/**
 * The Library's centre pane, ported from the prototype (lines 228-257).
 *
 * The draft's layout: a breadcrumb bar with a segmented filter on the right,
 * then the table. The "Check folder" button from the draft is deliberately
 * omitted — it belongs to Phase 3.
 *
 * Claims / Last checked / Conflicts render as em-dashes, matching the draft's
 * own "Never checked" rows. A zero would claim we looked and found none.
 */
export function DocumentTable({
  documents,
  breadcrumb,
  selectedDriveFileId,
  showRemoved,
  removedCount,
  liveCount,
  indexing,
  query,
}: {
  documents: DocumentRow[]
  breadcrumb: string[]
  selectedDriveFileId: string | null
  showRemoved: boolean
  removedCount: number
  liveCount: number
  indexing: boolean
  query: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const setParam = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params)
    mutate(next)
    router.replace(`${pathname}?${next}` as Route, { scroll: false })
  }

  return (
    <div className="sb-lib-centre">
      <div className="sb-lib-bar">
        <div className="sb-crumbs">
          {breadcrumb.map((part, i) => (
            <span key={`${part}-${i}`}>
              {i > 0 && <span className="sb-crumb-sep">/</span>}
              <span className={i === breadcrumb.length - 1 ? 'sb-crumb-here' : undefined}>
                {part}
              </span>
            </span>
          ))}
        </div>

        <div className="sb-lib-bar-spacer" />

        {/*
          Nocturne styles the active segment with `.seg-opt:has(input:checked)`
          and visually hides the input itself, so the label-wrapping-a-radio
          structure from the draft is load-bearing: a <button> with a modifier
          class gets no highlight at all.
        */}
        <div className="seg sb-lib-seg">
          <label className="seg-opt">
            <input
              type="radio"
              name="libf"
              checked={!showRemoved}
              onChange={() => setParam((p) => (p.delete('removed'), p.delete('doc')))}
            />
            All {liveCount}
          </label>
          <label className="seg-opt">
            <input
              type="radio"
              name="libf"
              checked={showRemoved}
              onChange={() => setParam((p) => (p.set('removed', '1'), p.delete('doc')))}
            />
            Removed {removedCount}
          </label>
        </div>
      </div>

      <div className="sb-lib-table-wrap">
        {documents.length === 0 ? (
          <EmptyState indexing={indexing} filtered={Boolean(query)} removed={showRemoved} />
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
              {documents.map((doc) => (
                <tr
                  key={doc.id}
                  onClick={() => setParam((p) => p.set('doc', doc.driveFileId))}
                  className={doc.driveFileId === selectedDriveFileId ? 'sb-row--on' : undefined}
                >
                  <td>
                    <div className="sb-doc-name">
                      <i className="ph ph-file-doc" />
                      <span className={doc.removedAt ? 'sb-struck' : undefined}>{doc.name}</span>
                      {doc.removedAt && (
                        <i
                          className="ph-bold ph-arrow-square-out"
                          style={{ color: 'var(--bad)', fontSize: 13 }}
                          title="No longer in your library folder"
                        />
                      )}
                      {doc.trashed && !doc.removedAt && (
                        <i
                          className="ph-bold ph-trash"
                          style={{ color: 'var(--bad)', fontSize: 13 }}
                          title="In Drive trash"
                        />
                      )}
                    </div>
                  </td>
                  <td className="sb-cell-faint">—</td>
                  <td>
                    <span className="tag tag-neutral">Unread</span>
                  </td>
                  <td className="sb-cell-faint">—</td>
                  <td className="sb-cell-faint" style={{ textAlign: 'right' }}>
                    —
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
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
        <p>No documents match that search.</p>
      </div>
    )
  }
  if (removed) {
    return (
      <div className="sb-empty">
        <p>Nothing has been removed from this folder.</p>
        <p className="sb-faint">
          Documents moved out of your library folder are kept here rather than deleted.
        </p>
      </div>
    )
  }
  return (
    <div className="sb-empty">
      <p>No Google Docs in this folder.</p>
      <p className="sb-faint">Slides, sheets and uploaded files are skipped.</p>
    </div>
  )
}
