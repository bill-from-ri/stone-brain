import Link from 'next/link'
import type { Route } from 'next'
import type {
  DocumentClaim,
  DocumentProposal,
  FinishedRun,
  RunIssue,
  RunRetraction,
} from '@/db/queries/extraction'
import type { RetractedClaim } from '@/lib/ontology/extraction-write'
import { viewIssue } from '@/lib/extraction/issues'
import { LocalTime } from '@/components/shared/LocalTime'
import { predicateText } from '@/components/shared/predicate'

/**
 * What the Library knows about a document's extraction: the claims it is a
 * source for, how the last run went, every claim that run dropped and why, and
 * the predicates it asked for.
 *
 * The dropped list is the point of §6: "a document that extracted badly must
 * not look identical to one that extracted well". Each card carries the reason
 * *and* the offending claim and quote, because a reason alone ("'governs' is
 * not in the vocabulary") is not something a person can judge without the
 * sentence it was about.
 *
 * Server components, rendered from rows the pane already fetched.
 */

/** How many dropped claims show before the rest fold away. */
const VISIBLE_ISSUES = 4

export function DocumentClaims({
  documentId,
  claims,
  total,
  extracted,
}: {
  /** The document's Stone Brain id, for the World's `?document=` filter. */
  documentId: string
  claims: DocumentClaim[]
  total: number
  extracted: boolean
}) {
  /*
   * Every link here carries the document filter. "Open World" means *this
   * document's* claims, not the whole graph; and a single claim opened under
   * the filter is certain to be among the rows the World loaded, where an
   * unfiltered World caps its list and could leave the pane with nothing to
   * draw from.
   */
  const inWorld = (claimId?: string) =>
    `/world?document=${documentId}${claimId ? `&claim=${claimId}` : ''}` as Route

  return (
    <div className="sb-x-section">
      <div className="sb-x-kicker-row">
        <div className="sb-detail-kicker">Claims · {total}</div>
        {total > 0 && (
          <Link className="sb-x-kicker-link" href={inWorld()}>
            Open World
          </Link>
        )}
      </div>

      {total === 0 ? (
        <div className="sb-detail-empty-claims">
          {extracted
            ? 'No claims cite this document.'
            : 'Not extracted yet. Extraction reads the document and files what it states as draft claims.'}
        </div>
      ) : (
        <>
          <ul className="sb-x-claims">
            {claims.map((claim) => (
              <li key={claim.id}>
                <Link href={inWorld(claim.id)}>
                  <Tuple subject={claim.subject} predicate={claim.predicate} object={claim.object} />
                </Link>
              </li>
            ))}
          </ul>
          {total > claims.length && (
            <p className="sb-x-note" style={{ marginTop: 6 }}>
              The {claims.length} most recent of {total}. Each opens in World.
            </p>
          )}
        </>
      )}
    </div>
  )
}

export function LastRun({ run }: { run: FinishedRun }) {
  const when = <LocalTime value={run.finishedAt ?? run.startedAt} options={WHEN} />

  if (run.status === 'failed') {
    return (
      <div className="sb-x-section">
        <div className="sb-detail-kicker" style={{ marginBottom: 9 }}>
          Last extraction
        </div>
        <div className="sb-x-box sb-x-box--bad">
          <p>{run.failureMessage ?? 'The run failed.'}</p>
          <p className="sb-x-note">Failed {when}. Nothing was written.</p>
        </div>
      </div>
    )
  }

  const dropped = run.issues.length
  // A re-extraction: the model was shown the document's existing claims.
  const revised = run.claimsKept > 0 || run.claimsRetracted > 0 || run.retractions.length > 0

  return (
    <div className="sb-x-section">
      <div className="sb-detail-kicker" style={{ marginBottom: 9 }}>
        Last extraction
      </div>
      <div className={`sb-x-box ${dropped > 0 ? 'sb-x-box--warn' : ''}`}>
        <p>
          {revised && `${run.claimsKept} kept · ${run.claimsRetracted} retracted · `}
          {run.claimsCreated} new · {run.claimsAlreadyPresent} already present ·{' '}
          {dropped === 0 ? 'none dropped' : `${dropped} dropped`}
        </p>
        <p className="sb-x-note">
          {when}
          {run.model ? ` · ${run.model}` : ''}
        </p>
      </div>

      {run.retractions.length > 0 && <Retractions retractions={run.retractions} />}
      {dropped > 0 && <DroppedClaims issues={run.issues} />}
    </div>
  )
}

const OUTCOME_LABEL: Record<RunRetraction['outcome'], string> = {
  deleted: 'Removed',
  citation_removed: 'Citation withdrawn — another document still states it',
  held: 'Kept',
}

/**
 * What a re-extraction said no longer holds, with the model's reason and what
 * the write path did about it. Shown before the dropped list: these are
 * decisions the run made about the graph, where dropped claims are ones it
 * failed to make.
 */
function Retractions({ retractions }: { retractions: RunRetraction[] }) {
  return (
    <div style={{ marginTop: 10 }}>
      <p className="sb-x-note" style={{ marginBottom: 8 }}>
        The model said the document no longer supports these:
      </p>
      <div className="sb-x-cards">
        {retractions.map((r) => {
          const claim = r.claim as RetractedClaim
          const quote = claim.quotes?.[0]
          return (
            <div key={r.id} className="sb-x-card">
              <Tuple
                subject={claim.subject}
                predicate={claim.predicate}
                object={claim.object ?? claim.value}
                raw
              />
              <div className="sb-x-reason">
                {OUTCOME_LABEL[r.outcome]} — {r.reason}
                {r.detail ? ` ${r.detail}` : ''}
              </div>
              {quote?.quote && (
                <div className="sb-x-quote">
                  “{quote.quote}”
                  {quote.paragraphIndex !== null && (
                    <span className="sb-faint"> ¶ {quote.paragraphIndex}</span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DroppedClaims({ issues }: { issues: RunIssue[] }) {
  const shown = issues.slice(0, VISIBLE_ISSUES)
  const rest = issues.slice(VISIBLE_ISSUES)

  return (
    <div style={{ marginTop: 10 }}>
      <p className="sb-x-note" style={{ marginBottom: 8 }}>
        The model stated these, and they did not reach the graph:
      </p>
      <div className="sb-x-cards">
        {shown.map((issue) => (
          <IssueCard key={issue.id} issue={issue} />
        ))}
      </div>
      {rest.length > 0 && (
        <details className="sb-x-more">
          <summary>{rest.length} more dropped</summary>
          <div className="sb-x-cards">
            {rest.map((issue) => (
              <IssueCard key={issue.id} issue={issue} />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function IssueCard({ issue }: { issue: RunIssue }) {
  const view = viewIssue(issue.stage, issue.received)

  return (
    <div className="sb-x-card">
      {(view.subject || view.predicate) && (
        <Tuple subject={view.subject} predicate={view.predicate} object={view.object} raw />
      )}
      <div className="sb-x-reason">
        {issue.stage === 'validation' ? 'Rejected' : 'Not written'} — {issue.message}
      </div>
      {view.quote && (
        <div className="sb-x-quote">
          “{view.quote}”{view.paragraph !== null && <span className="sb-faint"> ¶ {view.paragraph}</span>}
        </div>
      )}
    </div>
  )
}

export function DocumentProposals({ proposals }: { proposals: DocumentProposal[] }) {
  if (proposals.length === 0) return null

  return (
    <div className="sb-x-section">
      <div className="sb-x-kicker-row">
        <div className="sb-detail-kicker">Proposed predicates · {proposals.length}</div>
        <Link className="sb-x-kicker-link" href="/settings#proposals">
          Review
        </Link>
      </div>
      <p className="sb-x-note" style={{ marginBottom: 8 }}>
        Facts this document states that the vocabulary has no predicate for.
      </p>
      <div className="sb-x-cards">
        {proposals.map((p) => (
          <div key={p.id} className="sb-x-card sb-x-card--plain">
            <div className="sb-x-proposal-name">{p.name}</div>
            <div className="sb-x-reason">{p.description}</div>
            {p.quote && <div className="sb-x-quote">“{p.quote}”</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Subject — predicate → object, in the claim table's colours.
 *
 * `raw` for a dropped claim: its predicate may not be in the vocabulary at
 * all, so it is shown as the model spelled it (`governs`) rather than dressed
 * as a label, which would quietly tidy away the very thing that was wrong.
 * Otherwise `predicate` is the vocabulary's label, lower-cased for the middle
 * of a sentence the way the claim table writes it.
 */
function Tuple({
  subject,
  predicate,
  object,
  raw,
}: {
  subject: string | null
  predicate: string | null
  object: string | null
  raw?: boolean
}) {
  return (
    <div className="sb-x-tuple">
      <span className="sb-x-end">{subject ?? '?'}</span>{' '}
      <span className="sb-x-verb">{predicate ? (raw ? predicate : predicateText(predicate)) : '?'}</span>{' '}
      {object !== null && <span className="sb-x-end">{object}</span>}
    </div>
  )
}

const WHEN: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
}
