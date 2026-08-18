'use client'

import Link from 'next/link'
import type { Route } from 'next'
import type { DocumentRow } from '@/db/queries/library'
import { displayStatus } from '@/lib/documents/status'
import {
  EmptyState,
  PaneBarSpacer,
  RecordPane,
  RecordTable,
  useParamWriter,
  type Column,
} from '@/components/shared/RecordTable'

export type Crumb = {
  name: string
  folderId: string
}

/**
 * The Library's centre pane, ported from the prototype (lines 228-257).
 *
 * The draft's layout: a breadcrumb bar, then the table. The draft's "Check
 * folder" button is deliberately omitted — it belongs to Phase 3 — as is its
 * All/Removed filter, since soft-deleted documents are no longer shown here at
 * all (decisions §7a). The sync control takes the right of the bar, where the
 * draft put its own folder-level button.
 *
 * Claims / Last checked / Conflicts render as em-dashes, matching the draft's
 * own "Never checked" rows. A zero would claim we looked and found none.
 */
export function DocumentTable({
  documents,
  breadcrumb,
  selectedDriveFileId,
  indexing,
  actions,
}: {
  documents: DocumentRow[]
  breadcrumb: Crumb[]
  selectedDriveFileId: string | null
  indexing: boolean
  /** The sync button and its readout, which the page owns. */
  actions?: React.ReactNode
}) {
  const setParams = useParamWriter()

  const columns: Column<DocumentRow>[] = [
    {
      key: 'name',
      header: 'Name',
      width: '44%',
      cell: (doc) => (
        <div className="sb-doc-name">
          <i className="ph ph-file-doc" />
          <span>{doc.name}</span>
        </div>
      ),
    },
    { key: 'claims', header: 'Claims', cell: () => <span className="sb-cell-faint">—</span> },
    { key: 'status', header: 'Status', cell: (doc) => <StatusTag status={doc.status} /> },
    { key: 'checked', header: 'Last checked', cell: () => <span className="sb-cell-faint">—</span> },
    {
      key: 'conflicts',
      header: 'Conflicts',
      align: 'right',
      cell: () => <span className="sb-cell-faint">—</span>,
    },
  ]

  return (
    <RecordPane
      bar={
        <>
          <Breadcrumb crumbs={breadcrumb} />
          <PaneBarSpacer />
          {actions}
        </>
      }
    >
      <RecordTable
        columns={columns}
        rows={documents}
        rowKey={(doc) => doc.driveFileId}
        selectedKey={selectedDriveFileId}
        onSelect={(doc) => setParams((p) => p.set('doc', doc.driveFileId))}
        empty={
          indexing ? (
            <EmptyState
              icon="ph ph-circle-notch"
              title="Indexing your folder…"
              note="Documents appear here as they are found."
            />
          ) : (
            <EmptyState
              title="No Google Docs in this folder."
              note="Slides, sheets and uploaded files are skipped."
            />
          )
        }
      />
    </RecordPane>
  )
}

/**
 * Every ancestor is a link — the path is how you walk back up, not a label.
 * It begins at the root folder; nothing above it is inside the Drive grant.
 */
function Breadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav className="sb-crumbs" aria-label="Folder path">
      {crumbs.map((crumb, i) => {
        const here = i === crumbs.length - 1
        return (
          <span key={crumb.folderId}>
            {i > 0 && <span className="sb-crumb-sep">/</span>}
            {here ? (
              <span className="sb-crumb-here">{crumb.name}</span>
            ) : (
              <Link className="sb-crumb-link" href={`/library/${crumb.folderId}` as Route}>
                {crumb.name}
              </Link>
            )}
          </span>
        )
      })}
    </nav>
  )
}

function StatusTag({ status }: { status: string }) {
  const { label, tone } = displayStatus(status)
  return <span className={tone === 'good' ? 'tag sb-tag-ok' : 'tag tag-neutral'}>{label}</span>
}
