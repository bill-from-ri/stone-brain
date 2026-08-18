import type {
  ClaimRow,
  ClaimSourceRow,
  EntityTypeOption,
  PredicateOption,
  SignatureRow,
} from '@/db/queries/claims'
import { DetailPaneShell } from '@/components/shared/DetailPaneShell'
import { ClaimEditor } from './ClaimEditor'
import { ClaimActions } from './ClaimActions'

/**
 * The right pane, from the prototype (lines 500-514): the claim as a tuple, the
 * passage it was read from, and its actions.
 *
 * The prototype's "Conflicts with" block is deliberately absent — contradiction
 * detection is Phase 3, and a panel that never populates reads as broken. What
 * replaces it here is the §7a case that *is* implementable now: a source whose
 * document has left the Library is called out rather than quietly rendered as
 * an ordinary citation.
 *
 * A SERVER component, so opening a claim costs no round trip beyond the page.
 * It sits in the Library's pane shell, so it collapses, animates and closes the
 * same way the document pane does rather than standing there empty.
 */
export function ClaimDetail({
  claim,
  sources,
  composing,
  entities,
  entityTypes,
  predicates,
  signatures,
}: {
  claim: ClaimRow | null
  sources: ClaimSourceRow[]
  composing: boolean
  entities: { id: string; name: string; entityType: string }[]
  entityTypes: EntityTypeOption[]
  predicates: PredicateOption[]
  signatures: SignatureRow[]
}) {
  return (
    <DetailPaneShell open={composing || claim !== null} clears={['claim', 'new']} width={320}>
      {composing ? (
        <ClaimEditor
          entities={entities}
          entityTypes={entityTypes}
          predicates={predicates}
          signatures={signatures}
        />
      ) : (
        claim && <ClaimBody claim={claim} sources={sources} />
      )}
    </DetailPaneShell>
  )
}

function ClaimBody({ claim, sources }: { claim: ClaimRow; sources: ClaimSourceRow[] }) {
  return (
    <>
      <div className="sb-detail-kicker">Claim</div>
      <div className="sb-claim-tuple">
        ({claim.subjectName}, <span className="sb-faint">{claim.subjectType}</span>,{' '}
        {claim.objectName ? (
          <>
            {claim.objectName}, <span className="sb-faint">{claim.objectType}</span>,{' '}
          </>
        ) : (
          <>
            {claim.value}, <span className="sb-faint">{claim.valueType}</span>,{' '}
          </>
        )}
        {claim.predicate}
        {claim.startTime || claim.endTime ? `, ${claim.startTime ?? '…'}–${claim.endTime ?? '…'}` : ''})
      </div>

      <div className="sb-detail-tags" style={{ marginTop: 12 }}>
        <span className="tag tag-neutral">{claim.canonicity === 'canon' ? 'Canon' : 'Draft'}</span>
        <span className="tag tag-neutral">{provenanceLabel(claim.createdBy)}</span>
        {claim.inverseName && <span className="tag tag-neutral">Inverse: {claim.inverseName}</span>}
      </div>

      <div className="sb-tree-divider" style={{ margin: '16px 0' }} />

      <div className="sb-detail-kicker" style={{ marginBottom: 9 }}>
        {sources.length === 0 ? 'Source' : 'Read from'}
      </div>

      {sources.length === 0 ? (
        <p className="sb-faint sb-claim-note">
          Entered by hand. A claim needs no document behind it.
        </p>
      ) : (
        sources.map((source) => (
          <div key={source.id} className="sb-claim-source">
            {source.quote && <blockquote className="sb-quote">“{source.quote}”</blockquote>}
            <div className={`sb-claim-cite${source.removed ? ' sb-claim-cite--gone' : ''}`}>
              {source.paragraphIndex !== null && `¶ ${source.paragraphIndex} · `}
              {source.documentName ?? 'Unknown document'}
              {source.removed && ' · no longer in the Library'}
            </div>
          </div>
        ))
      )}

      <div className="sb-tree-divider" style={{ margin: '16px 0' }} />

      <ClaimActions claimId={claim.id} hasInverse={Boolean(claim.inverseName && claim.objectId)} />
    </>
  )
}

function provenanceLabel(createdBy: string): string {
  if (createdBy === 'seed') return 'Seeded by hand'
  if (createdBy === 'llm') return 'Extracted'
  return 'Entered by hand'
}
