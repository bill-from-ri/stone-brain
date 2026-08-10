import type { DocumentRow } from '@/db/queries/library'
import { NotYetRealPanel } from '@/components/stub/NotYetReal'

/**
 * The Library's right pane (prototype lines 259-285). A SERVER component: it
 * reads the selected document straight from the row the page already fetched,
 * so there is no prop drilling and no second round trip.
 *
 * Everything here comes from our own projection — opening the detail pane makes
 * no Drive call at all.
 */
export function DetailPane({ doc }: { doc: DocumentRow | null }) {
  if (!doc) {
    return (
      <aside className="sb-lib-detail">
        <div className="sb-empty" style={{ paddingTop: 60 }}>
          <i className="ph ph-cursor-click" />
          <p className="sb-faint">Select a document to see its details.</p>
        </div>
      </aside>
    )
  }

  return (
    <aside className="sb-lib-detail">
      <div className="sb-kicker">Selected</div>
      <h2 className="sb-detail-title">{doc.name}</h2>
      <div className="sb-detail-meta">
        Google Doc
        {doc.ownerDisplayName ? ` · ${doc.ownerDisplayName}` : ''}
      </div>

      {doc.removedAt && (
        <div className="sb-banner" style={{ borderRadius: 8, margin: '12px 0' }}>
          <i className="ph-bold ph-warning-circle" />
          <div className="sb-banner-text">
            This document is no longer in your library folder. It is kept here rather than deleted —
            move it back in Drive and it returns automatically.
          </div>
        </div>
      )}

      <dl className="sb-detail-facts">
        <Fact label="Status" value={<span className="tag tag-neutral">Unread</span>} />
        <Fact label="Modified" value={formatDate(doc.modifiedTime)} />
        <Fact label="Created" value={formatDate(doc.createdTime)} />
        <Fact label="Drive version" value={doc.driveVersion?.toString() ?? '—'} />
      </dl>

      <div className="sb-detail-actions">
        {doc.webViewLink && (
          <a
            className="btn btn-primary"
            href={doc.webViewLink}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open in Drive <i className="ph-bold ph-arrow-square-out" />
          </a>
        )}
      </div>

      <NotYetRealPanel phase={2}>
        Extracted claims, verification status and conflicts appear here once claim extraction lands.
      </NotYetRealPanel>

      {/* Small and muted, but you will want these the first time a sync looks wrong. */}
      <div className="sb-detail-ids">
        <div>
          <span className="sb-faint">Drive id</span> <code>{doc.driveFileId}</code>
        </div>
        <div>
          <span className="sb-faint">Stone Brain id</span> <code>{doc.id}</code>
        </div>
      </div>
    </aside>
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

function formatDate(date: Date | null): string {
  if (!date) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(date)
}
