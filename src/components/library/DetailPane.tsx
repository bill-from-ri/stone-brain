import { Suspense } from 'react'
import { getDocument, type DocumentRow } from '@/db/queries/library'
import { flags } from '@/lib/flags'
import { displayStatus } from '@/lib/documents/status'
import { requireReady } from '@/lib/auth/guard'
import { DetailPaneShell } from '@/components/shared/DetailPaneShell'
import { SkelDetail } from '@/components/shared/Skeleton'

/**
 * The Library's right pane, ported from the prototype (lines 259-285).
 *
 * The draft's shape: "Selected" kicker, title, a one-line meta row, a tag row,
 * a faded divider, then a section of cards and two block buttons. Phase 1 keeps
 * that skeleton and fills it with the metadata we actually have; the claims
 * section states plainly that it is empty rather than showing invented cards.
 *
 * A SERVER component, and it does its own read rather than taking the row from
 * the page. That read used to be a fourth await in the page body, after the
 * batch that fetches the tree, the counts and the table — so every Library
 * navigation paid for it, including the ones with nothing selected, and the
 * whole screen waited on a query that fills one 290px column.
 *
 * Suspended here instead: the frame opens on the click, the tree and the table
 * render without waiting, and the body streams in behind a skeleton. It makes
 * no Drive call either way.
 */
export function DetailPane({ driveFileId }: { driveFileId: string | null }) {
  return (
    <DetailPaneShell open={driveFileId !== null} clears={['doc']}>
      {driveFileId && (
        // Keyed so that moving between documents shows the skeleton again
        // rather than holding the previous one's details under a new title.
        <Suspense key={driveFileId} fallback={<SkelDetail />}>
          <DetailBodyLoader driveFileId={driveFileId} />
        </Suspense>
      )}
    </DetailPaneShell>
  )
}

/**
 * Resolves the session itself rather than accepting a userId as a prop.
 *
 * `getSession` is wrapped in React's cache(), so this costs no extra query — and
 * it keeps the rule from guard.ts intact: every query in src/db/queries takes a
 * userId that came from the session, at the point it is used.
 */
async function DetailBodyLoader({ driveFileId }: { driveFileId: string }) {
  const session = await requireReady()
  const doc = await getDocument(session.user.id, driveFileId)

  // A `?doc=` pointing at something that has left the folder: say so, rather
  // than leaving the skeleton pulsing at a document that is never coming.
  if (!doc) {
    return <p className="sb-faint sb-claim-note">That document is no longer in this folder.</p>
  }

  return <DetailBody doc={doc} />
}

function StatusTag({ status }: { status: string }) {
  const { label, tone } = displayStatus(status)
  return <span className={tone === 'good' ? 'tag sb-tag-ok' : 'tag tag-neutral'}>{label}</span>
}

function DetailBody({ doc }: { doc: DocumentRow }) {
  return (
    <>
      <div className="sb-detail-kicker">Selected</div>
      <div className="sb-detail-title">{doc.name}</div>
      <div className="sb-detail-meta">
        Google Doc
        {doc.sizeBytes !== null && ` · ${formatSize(doc.sizeBytes)}`}
        {doc.ownerDisplayName && ` · ${doc.ownerDisplayName}`}
      </div>

      <div className="sb-detail-tags">
        <StatusTag status={doc.status} />
      </div>

      <div className="sb-tree-divider" style={{ margin: '16px 0' }} />

      <div className="sb-detail-kicker" style={{ marginBottom: 9 }}>
        Details
      </div>
      <dl className="sb-facts">
        <Fact label="Modified" value={formatDate(doc.modifiedTime)} />
        <Fact label="Created" value={formatDate(doc.createdTime)} />
        <Fact label="Owner" value={doc.ownerDisplayName ?? '—'} />
        <Fact label="Size" value={doc.sizeBytes !== null ? formatSize(doc.sizeBytes) : '—'} />
        <Fact label="Drive version" value={doc.driveVersion?.toString() ?? '—'} />
      </dl>

      <div className="sb-tree-divider" style={{ margin: '16px 0' }} />

      <div className="sb-detail-kicker" style={{ marginBottom: 9 }}>
        Extracted claims
      </div>
      <div className="sb-detail-empty-claims">
        No claims yet — extraction arrives in Phase&nbsp;2.
      </div>

      {doc.webViewLink && (
        <a
          className="btn btn-primary btn-block sb-detail-btn"
          href={doc.webViewLink}
          target="_blank"
          rel="noopener noreferrer"
        >
          <i className="ph-bold ph-arrow-square-out" />
          Open in Drive
        </a>
      )}

      {flags.showDocumentIds && (
        <div className="sb-detail-ids">
          <div>
            <span className="sb-faint">Drive id</span> <code>{doc.driveFileId}</code>
          </div>
          <div>
            <span className="sb-faint">Stone Brain id</span> <code>{doc.id}</code>
          </div>
        </div>
      )}
    </>
  )
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="sb-fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

/**
 * Drive's `size` for a native Doc is its internal storage size, which includes
 * embedded images — a rough proxy for length, not a word count. A real word
 * count needs files.export, which Phase 2 does anyway.
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(date: Date | null): string {
  if (!date) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}
