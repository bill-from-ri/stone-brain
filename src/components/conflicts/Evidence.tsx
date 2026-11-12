import type { ConflictClaim } from '@/db/queries/conflicts'

/**
 * The passages a claim was read from — the thing a person actually adjudicates
 * on. The same quote-and-citation shape as the World's claim pane, so a source
 * reads the same wherever it is shown, including the §7a case of a document
 * that has left the Library: the snapshotted quote is still shown, and the
 * citation says plainly that the document is gone.
 */
export function Evidence({ claim }: { claim: ConflictClaim }) {
  if (claim.sources.length === 0) {
    return (
      <p className="sb-faint sb-claim-note sb-cf-evidence">
        Entered by hand, with no document behind it.
      </p>
    )
  }

  return (
    <>
      {claim.sources.map((source) => (
        <div key={source.id} className="sb-cf-evidence">
          {source.quote && <blockquote className="sb-quote">“{source.quote}”</blockquote>}
          <div className={`sb-claim-cite${source.removed ? ' sb-claim-cite--gone' : ''}`}>
            {source.paragraphIndex !== null && `¶ ${source.paragraphIndex} · `}
            {source.webViewLink ? (
              <a href={source.webViewLink} target="_blank" rel="noreferrer">
                {source.documentName ?? 'Untitled document'}
              </a>
            ) : (
              (source.documentName ?? 'Unknown document')
            )}
            {source.removed && ' · no longer in the Library'}
          </div>
        </div>
      ))}
    </>
  )
}
