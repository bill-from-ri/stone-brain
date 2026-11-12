import Link from 'next/link'
import type { Route } from 'next'
import type {
  ClaimRow,
  EntityTypeOption,
  PredicateOption,
  SignatureRow,
} from '@/db/queries/claims'
import type {
  ConflictClaim,
  ConflictSide,
  ValueConflict,
  VanishedSourceConflict,
} from '@/db/queries/conflicts'
import { worldUrl } from '@/lib/world-url'
import {
  DeleteUnsourcedButton,
  DismissButton,
  EditClaimButton,
  KeepSideButton,
} from './ConflictActions'
import { answerOf, explainValue, periodText, provenanceLabel, sentenceOf } from './copy'
import { Evidence } from './Evidence'

/** What the edit buttons need: the World's claim rows and the editor's vocabulary. */
export type EditSupport = {
  claims: Map<string, ClaimRow>
  entities: { id: string; name: string; entityType: string }[]
  entityTypes: EntityTypeOption[]
  predicates: PredicateOption[]
  signatures: SignatureRow[]
}

type Position = { index: number; total: number; prev: Route | null; next: Route | null }

/** "Conflict 2 of 6", with Previous / Next — the prototype's header row. */
function Stepper({ kicker, position }: { kicker: string; position: Position }) {
  return (
    <div className="sb-cf-kicker-row">
      <div className="sb-detail-kicker">
        {kicker} · {position.index + 1} of {position.total}
      </div>
      <div className="sb-pane-bar-spacer" />
      {position.prev && (
        <Link href={position.prev} className="btn btn-secondary">
          <i className="ph ph-arrow-up" />
          Previous
        </Link>
      )}
      {position.next && (
        <Link href={position.next} className="btn btn-secondary">
          Next
          <i className="ph ph-arrow-down" />
        </Link>
      )}
    </div>
  )
}

/* ------------------------------------------------------- contradictory values */

/**
 * One contradiction: the subject, the predicate, and every competing answer
 * side by side with the passages behind it — the prototype's two cards
 * (lines 548-578), generalised to however many sides there are.
 *
 * What each side offers is what resolving it can actually mean here: keep it
 * (deleting what disagrees with it), or edit a claim on it — most often to add
 * the dates that make two rulers a succession. And for the whole conflict,
 * "not a conflict", which is reversible.
 */
export function ValueConflictView({
  conflict,
  position,
  edit,
}: {
  conflict: ValueConflict
  position: Position
  edit: EditSupport
}) {
  const byId = new Map(conflict.sides.flatMap((s) => s.claims.map((c) => [c.id, c] as const)))
  const describe = (id: string) => {
    const claim = byId.get(id)
    if (!claim) return 'a claim no longer shown'
    const when = periodText(claim)
    return `${sentenceOf(claim)}${when ? ` (${when})` : ''}`
  }

  return (
    <div className="sb-cf-body">
      <Stepper kicker="Contradiction" position={position} />

      <h2 className="sb-cf-heading">
        <Link href={worldUrl({ entity: conflict.subject.id })} className="sb-entity-link">
          {conflict.subject.name}
        </Link>{' '}
        <span className="sb-claim-predicate">— {conflict.predicate.label}</span>
      </h2>
      <p className="sb-cf-explain">{explainValue(conflict)}</p>

      <div className="sb-cf-sides">
        {conflict.sides.map((side) => (
          <SideCard
            key={side.claims[0]!.id}
            conflict={conflict}
            side={side}
            displaced={side.displaces.map(describe)}
            edit={edit}
          />
        ))}
      </div>

      <div className="sb-cf-actions">
        <DismissButton
          conflictId={conflict.id}
          dismissed={conflict.dismissed}
          label={conflict.dismissed ? 'Reopen' : 'Not a conflict'}
        />
      </div>

      {conflict.dismissed ? (
        <div className="sb-cf-note">
          <strong>Dismissed.</strong> You marked these as not contradicting each other. It stays
          out of the inbox unless a claim you have not seen joins it.
        </div>
      ) : (
        <div className="sb-cf-note">
          <strong>Keeping a side</strong> deletes only the claims that actually disagree with it,
          each with its reverse direction. A claim on another side that does not overlap it in
          time is left alone.
        </div>
      )}
    </div>
  )
}

function SideCard({
  conflict,
  side,
  displaced,
  edit,
}: {
  conflict: ValueConflict
  side: ConflictSide
  displaced: string[]
  edit: EditSupport
}) {
  const first = side.claims[0]!
  const sourceCount = side.claims.reduce((n, c) => n + c.sources.length, 0)
  const canon = side.claims.some((c) => c.canonicity === 'canon')

  return (
    <section className="sb-cf-side" aria-label={answerOf(first)}>
      <div className="sb-cf-side-head">
        <span className="tag tag-neutral">{canon ? 'Canon' : 'Draft'}</span>
        <span className="tag tag-neutral">{provenanceLabel(first.createdBy)}</span>
        <div className="sb-pane-bar-spacer" />
        <span className="sb-faint" style={{ fontSize: 11 }}>
          {sourceCount === 0 ? 'no sources' : `${sourceCount} ${sourceCount === 1 ? 'source' : 'sources'}`}
        </span>
      </div>

      <div className="sb-cf-side-value">
        {first.objectId ? (
          <Link href={worldUrl({ entity: first.objectId })} className="sb-entity-link">
            {answerOf(first)}
          </Link>
        ) : (
          answerOf(first)
        )}{' '}
        <span className="sb-claim-type">{first.objectType ?? conflict.predicate.valueType}</span>
      </div>

      {side.claims.map((claim) => (
        <SideClaim key={claim.id} claim={claim} several={side.claims.length > 1} edit={edit} />
      ))}

      <div className="sb-cf-side-actions">
        {/* Nothing to keep against when every claim this side disagrees with
            is already gone — which a stale render could briefly show. */}
        {displaced.length > 0 && !conflict.dismissed && (
          <KeepSideButton
            conflictId={conflict.id}
            claimId={first.id}
            answer={answerOf(first)}
            displaced={displaced}
          />
        )}
      </div>
    </section>
  )
}

function SideClaim({
  claim,
  several,
  edit,
}: {
  claim: ConflictClaim
  several: boolean
  edit: EditSupport
}) {
  const when = periodText(claim)
  const row = edit.claims.get(claim.id)

  return (
    <div className="sb-cf-claim">
      <div className={`sb-cf-when${when ? '' : ' sb-cf-when--none'}`}>
        <i className="ph ph-calendar-blank" aria-hidden />
        {when ?? 'Undated'}
        {/* Several claims on one side differ only in dates and provenance, so
            each says its own; one alone has said it in the card's header. */}
        {several && <span className="sb-faint">· {provenanceLabel(claim.createdBy)}</span>}
      </div>

      <Evidence claim={claim} />

      {row && (
        <div className="sb-cf-claim-tools">
          <EditClaimButton
            claim={row}
            entities={edit.entities}
            entityTypes={edit.entityTypes}
            predicates={edit.predicates}
            signatures={edit.signatures}
          />
        </div>
      )}
    </div>
  )
}

/* ---------------------------------------------------------- vanished sources */

/**
 * A claim every one of whose documents has left the Library (ADR §7a). The
 * evidence is still shown — it was snapshotted for exactly this — and the
 * choice is the one §7a offers: delete the claim, or keep it as it stands.
 * Pointing it at another document is not offered yet.
 */
export function VanishedSourceView({
  conflict,
  position,
}: {
  conflict: VanishedSourceConflict
  position: Position
}) {
  const { claim } = conflict
  const when = periodText(claim)

  return (
    <div className="sb-cf-body">
      <Stepper kicker="Missing source" position={position} />

      <h2 className="sb-cf-heading">{sentenceOf(claim)}</h2>
      <p className="sb-cf-explain">
        Every document this claim was read from has left the Library — deleted, trashed, or moved
        out of the folder. The passage it was based on is kept below. If the document comes back,
        this clears by itself.
      </p>

      <div className="sb-cf-sides">
        <section className="sb-cf-side">
          <div className="sb-cf-side-head">
            <span className="tag tag-neutral">{claim.canonicity === 'canon' ? 'Canon' : 'Draft'}</span>
            <span className="tag tag-neutral">{provenanceLabel(claim.createdBy)}</span>
          </div>
          <div className="sb-claim-tuple">
            ({claim.subjectName}, <span className="sb-faint">{claim.subjectType}</span>,{' '}
            {answerOf(claim)}, <span className="sb-faint">{claim.objectType ?? claim.valueType}</span>,{' '}
            {claim.predicate}
            {when ? `, ${when}` : ''})
          </div>
          <Evidence claim={claim} />
        </section>
      </div>

      <div className="sb-cf-actions">
        {!conflict.dismissed && (
          <>
            <DeleteUnsourcedButton conflictId={conflict.id} sentence={sentenceOf(claim)} />
            <span className="sb-cf-actions-sep">·</span>
          </>
        )}
        <DismissButton
          conflictId={conflict.id}
          dismissed={conflict.dismissed}
          label={conflict.dismissed ? 'Reopen' : 'Keep it as it stands'}
        />
      </div>

      {conflict.dismissed && (
        <div className="sb-cf-note">
          <strong>Kept as it stands.</strong> You accepted this claim without a source. Reopen it to
          decide again.
        </div>
      )}
    </div>
  )
}
