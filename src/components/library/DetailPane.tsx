import type { DocumentRow } from '@/db/queries/library'
import { flags } from '@/lib/flags'

/**
 * The Library's right pane, ported from the prototype (lines 259-285).
 *
 * The draft's shape: "Selected" kicker, title, a one-line meta row, a tag row,
 * a faded divider, then a section of cards and two block buttons. Phase 1 keeps
 * that skeleton and fills it with the metadata we actually have; the claims
 * section states plainly that it is empty rather than showing invented cards.
 *
 * A SERVER component — it reads the row the page already fetched, so opening the
 * pane makes no Drive call and no second round trip.
 */
export function DetailPane({ doc }: { doc: DocumentRow | null }) {
  if (!doc) {
    return (
      <div className="sb-lib-detail">
        <div className="sb-detail-blank">
          <i className="ph ph-file-dashed" />
          <p>Select a document.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="sb-lib-detail">
      <div className="sb-detail-kicker">Selected</div>
      <div className="sb-detail-title">{doc.name}</div>
      <div className="sb-detail-meta">
        Google Doc
        {doc.sizeBytes !== null && ` · ${formatSize(doc.sizeBytes)}`}
        {doc.ownerDisplayName && ` · ${doc.ownerDisplayName}`}
      </div>

      <div className="sb-detail-tags">
        <span className="tag tag-neutral">Unverified</span>
        {doc.removedAt && (
          <span className="tag" style={{ background: 'var(--bad-dim)', color: '#e08c86' }}>
            Removed from folder
          </span>
        )}
        {doc.trashed && !doc.removedAt && (
          <span className="tag" style={{ background: 'var(--bad-dim)', color: '#e08c86' }}>
            In trash
          </span>
        )}
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

      {doc.removedAt && (
        <p className="sb-detail-note">
          This document is no longer in your library folder. It is kept rather than deleted — move
          it back in Drive and it returns automatically.
        </p>
      )}

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
    </div>
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
