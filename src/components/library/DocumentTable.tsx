'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { Route } from 'next'
import type { DocumentRow } from '@/db/queries/library'
import { displayStatus } from '@/lib/documents/status'

/**
 * The Library's centre pane, ported from the prototype (lines 228-257).
 *
 * The draft's layout: a breadcrumb bar, then the table. The draft's "Check
 * folder" button is deliberately omitted — it belongs to Phase 3 — as is its
 * All/Removed filter, since soft-deleted documents are no longer shown here at
 * all (decisions §7a).
 *
 * Claims / Last checked / Conflicts render as em-dashes, matching the draft's
 * own "Never checked" rows. A zero would claim we looked and found none.
 *
 * Status reads the stored column through one shared map, rather than the
 * hardcoded "Unverified" Phase 1 shipped on every row.
 */
export function DocumentTable({
  documents,
  breadcrumb,
  selectedDriveFileId,
  indexing,
}: {
  documents: DocumentRow[]
  breadcrumb: string[]
  selectedDriveFileId: string | null
  indexing: boolean
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
      </div>

      <div className="sb-lib-table-wrap">
        {documents.length === 0 ? (
          <EmptyState indexing={indexing} />
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
                      <span>{doc.name}</span>
                    </div>
                  </td>
                  <td className="sb-cell-faint">—</td>
                  <td>
                    <StatusTag status={doc.status} />
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

function StatusTag({ status }: { status: string }) {
  const { label, tone } = displayStatus(status)
  return <span className={tone === 'good' ? 'tag sb-tag-ok' : 'tag tag-neutral'}>{label}</span>
}

function EmptyState({ indexing }: { indexing: boolean }) {
  if (indexing) {
    return (
      <div className="sb-empty">
        <i className="ph ph-circle-notch" />
        <p>Indexing your folder…</p>
        <p className="sb-faint">Documents appear here as they are found.</p>
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
