import Link from 'next/link'
import { Suspense } from 'react'
import { getDocumentClaims, getDocumentProposals, getDocumentRuns } from '@/db/queries/extraction'
import { getDocument, type DocumentRow } from '@/db/queries/library'
import { flags } from '@/lib/flags'
import { displayStatus, isStale } from '@/lib/documents/status'
import { requireReady } from '@/lib/auth/guard'
import { getProviderStatus } from '@/lib/llm/provider'
import { DetailPaneShell } from '@/components/shared/DetailPaneShell'
import { SkelDetail } from '@/components/shared/Skeleton'
import { ExtractControl } from './ExtractControl'
import { DocumentClaims, DocumentProposals, LastRun } from './ExtractionReport'
import { VerifyButton } from './VerifyButton'
import '@/styles/library-extraction.css'

/**
 * The Library's right pane, ported from the prototype (lines 259-285).
 *
 * The draft's shape: "Selected" kicker, title, a one-line meta row, a tag row,
 * a faded divider, then a section of cards and block buttons. Phase 2B fills
 * the cards with the document's extraction: the Extract button, the claims it
 * is a source for, how the last run went and what it dropped (§6, §8).
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
 *
 * `conflictCount` is the one thing handed in rather than read here: the page
 * already holds the whole-library conflict map for the table, and recomputing
 * a derived-by-query count for one row would run that query twice.
 */
export function DetailPane({
  driveFileId,
  conflictCount = 0,
}: {
  driveFileId: string | null
  conflictCount?: number
}) {
  return (
    <DetailPaneShell open={driveFileId !== null} clears={['doc']}>
      {driveFileId && (
        // Keyed so that moving between documents shows the skeleton again
        // rather than holding the previous one's details under a new title.
        <Suspense key={driveFileId} fallback={<SkelDetail />}>
          <DetailBodyLoader driveFileId={driveFileId} conflictCount={conflictCount} />
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
async function DetailBodyLoader({
  driveFileId,
  conflictCount,
}: {
  driveFileId: string
  conflictCount: number
}) {
  const session = await requireReady()
  const userId = session.user.id
  const doc = await getDocument(userId, driveFileId)

  // A `?doc=` pointing at something that has left the folder: say so, rather
  // than leaving the skeleton pulsing at a document that is never coming.
  if (!doc) {
    return <p className="sb-faint sb-claim-note">That document is no longer in this folder.</p>
  }

  // Everything else is keyed by the row's own id, so it waits for the row —
  // and then goes out as one batch rather than four round trips in a line.
  const [runs, claims, proposals, provider] = await Promise.all([
    getDocumentRuns(userId, doc.id),
    getDocumentClaims(userId, doc.id),
    getDocumentProposals(userId, doc.id),
    getProviderStatus(userId),
  ])

  return (
    <DetailBody
      doc={doc}
      conflictCount={conflictCount}
      extraction={
        <>
          <ExtractControl
            documentId={doc.id}
            // From the status, not the run history: a first attempt that
            // failed wrote nothing, so the next one is still a first extraction.
            extractedBefore={doc.status !== 'unread'}
            providerConfigured={provider !== null}
            runningSince={runs.runningSince?.toISOString() ?? null}
          />
          <VerifyButton documentId={doc.id} status={doc.status} />
        </>
      }
      report={
        <>
          <DocumentClaims claims={claims} total={doc.claimCount} extracted={doc.status !== 'unread'} />
          {runs.latest && <LastRun run={runs.latest} />}
          <DocumentProposals proposals={proposals} />
        </>
      }
    />
  )
}

function StatusTag({ status }: { status: string }) {
  const { label, tone } = displayStatus(status)
  return <span className={tone === 'good' ? 'tag sb-tag-ok' : 'tag tag-neutral'}>{label}</span>
}

function DetailBody({
  doc,
  conflictCount,
  extraction,
  report,
}: {
  doc: DocumentRow
  conflictCount: number
  extraction: React.ReactNode
  report: React.ReactNode
}) {
  const stale = isStale(doc)

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
        {doc.status !== 'unread' && (
          <span className="tag tag-neutral">
            {doc.claimCount} {doc.claimCount === 1 ? 'claim' : 'claims'}
          </span>
        )}
        {conflictCount > 0 && (
          <Link className="tag sb-x-tag-bad" href="/conflicts">
            {conflictCount} {conflictCount === 1 ? 'conflict' : 'conflicts'}
          </Link>
        )}
        {stale && <span className="tag sb-x-tag-warn">Changed since extraction</span>}
      </div>

      <div className="sb-tree-divider" style={{ margin: '16px 0' }} />

      {/* §8's re-extract prompt. Staleness is drive_version against the version
          the last extraction read — see isStale for why it is not the
          revision id. */}
      {stale && (
        <div className="sb-x-box sb-x-box--warn" style={{ marginBottom: 9 }}>
          <p>This document has changed in Drive since it was last extracted.</p>
          <p className="sb-x-note">
            Version {doc.extractedDriveVersion} was read; Drive is now at {doc.driveVersion}.
            Re-extracting adds what is new and keeps every existing claim.
          </p>
        </div>
      )}

      {extraction}

      <div className="sb-tree-divider" style={{ margin: '16px 0' }} />

      {report}

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
        <Fact label="Version extracted" value={doc.extractedDriveVersion?.toString() ?? '—'} />
      </dl>

      {doc.webViewLink && (
        <a
          className="btn btn-secondary btn-block sb-detail-btn"
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
