'use client'

import Link from 'next/link'
import type { Route } from 'next'
import type { DocumentRow } from '@/db/queries/library'
import { displayStatus, isStale } from '@/lib/documents/status'
import { SyncControls } from './SyncControls'
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
 * Claims, Extracted and Conflicts are real as of Phase 2B, and still render
 * as em-dashes for a document that has never been extracted, matching the
 * draft's own "Never checked" rows: a zero there would claim we looked and
 * found none. The draft's "Last checked" column was a conflict check; what
 * this product can actually date is the last successful extraction, so that
 * is what the column says.
 *
 * `conflictCounts` arrives from the page (document id → open conflicts among
 * the claims citing it) rather than being fetched here, which a client
 * component could not do anyway.
 */
export function DocumentTable({
  documents,
  breadcrumb,
  selectedDriveFileId,
  indexing,
  conflictCounts,
}: {
  documents: DocumentRow[]
  breadcrumb: Crumb[]
  selectedDriveFileId: string | null
  indexing: boolean
  conflictCounts: Record<string, number>
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
          {isStale(doc) && (
            <i
              className="ph-bold ph-arrows-clockwise sb-x-stale-mark"
              title="Changed in Drive since it was last extracted"
              aria-label="Changed since last extraction"
            />
          )}
        </div>
      ),
    },
    {
      key: 'claims',
      header: 'Claims',
      cell: (doc) =>
        neverExtracted(doc) ? (
          <span className="sb-cell-faint">—</span>
        ) : (
          <span className="sb-cell-muted">{doc.claimCount}</span>
        ),
    },
    { key: 'status', header: 'Status', cell: (doc) => <StatusTag status={doc.status} /> },
    {
      key: 'extracted',
      header: 'Extracted',
      cell: (doc) =>
        doc.lastExtractedAt ? (
          <span className="sb-cell-muted">{formatDay(doc.lastExtractedAt)}</span>
        ) : (
          <span className="sb-cell-faint">—</span>
        ),
    },
    {
      key: 'conflicts',
      header: 'Conflicts',
      align: 'right',
      cell: (doc) => <ConflictCell count={conflictCounts[doc.id] ?? 0} extracted={!neverExtracted(doc)} />,
    },
  ]

  return (
    <RecordPane
      bar={
        <>
          <Breadcrumb crumbs={breadcrumb} />
          <PaneBarSpacer />
          <SyncControls initialCrawlDone={!indexing} />
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

const neverExtracted = (doc: DocumentRow) => doc.status === 'unread' && doc.claimCount === 0

function ConflictCell({ count, extracted }: { count: number; extracted: boolean }) {
  if (count > 0) {
    return (
      <Link
        className="sb-x-conflicts-link"
        href="/conflicts"
        // The row itself is a click target that opens the pane; this link
        // goes somewhere else, so it must not also select the row on the way.
        onClick={(event) => event.stopPropagation()}
      >
        <i className="ph-bold ph-warning-diamond" />
        {count}
      </Link>
    )
  }
  return <span className="sb-cell-faint">{extracted ? '0' : '—'}</span>
}

/**
 * Day precision is enough for a column, and a fixed locale and the UTC
 * calendar date keep the server's render and the browser's hydration in
 * agreement — this is a client component, rendered in both places.
 */
function formatDay(date: Date | string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(date))
}

function StatusTag({ status }: { status: string }) {
  const { label, tone } = displayStatus(status)
  return <span className={tone === 'good' ? 'tag sb-tag-ok' : 'tag tag-neutral'}>{label}</span>
}
