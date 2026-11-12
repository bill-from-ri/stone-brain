import Link from 'next/link'
import type { Route } from 'next'
import type { DuplicateConflict, DuplicateEntity } from '@/lib/duplicates/types'
import { worldUrl } from '@/lib/world-url'
import { DismissButton } from './ConflictActions'
import { Stepper, type Position } from './ConflictView'
import { provenanceLabel } from './copy'
import { MergeActions } from './MergeActions'

/**
 * A possible duplicate: two entities whose names say "one thing, two
 * spellings", set side by side with what would let a person decide — what
 * each is, where it was read from, how much hangs off it, and which entities
 * both are connected to.
 *
 * The check is only a resemblance between names, so the view says *why* it
 * suggested the pair (the check's own sentences) and leaves the decision
 * open: merge them, choosing which survives, or say they are not the same,
 * which is a dismissal like any other and can be reopened.
 *
 * A server component; only the choice of survivor and the merge preview it
 * drives live on the client, in MergeActions.
 */
export function DuplicateView({
  conflict,
  position,
  next,
}: {
  conflict: DuplicateConflict
  position: Position
  /** Where to go once the pair is merged and gone. */
  next: Route
}) {
  const [a, b] = conflict.entities

  return (
    <div className="sb-cf-body">
      <Stepper kicker="Possible duplicate" position={position} />

      <h2 className="sb-cf-heading">
        <EntityLink entity={a} /> <span className="sb-faint">·</span> <EntityLink entity={b} />
      </h2>
      <p className="sb-cf-explain">
        {conflict.crossType
          ? `These look like one thing recorded twice, once as a ${a.entityType} and once as a ${b.entityType}. Merging keeps one, moves the other's claims onto it — changing the ones its type will not take, where there is a clear equivalent — and keeps the other's name as a variant.`
          : `These look like one ${a.entityType} recorded under two names. Merging keeps one, moves the other's claims onto it, and keeps the other's name as a variant.`}
      </p>

      <ul className="sb-dup-reasons">
        {conflict.reasons.map((reason) => (
          <li key={reason.code}>{reason.text}</li>
        ))}
      </ul>

      <div className="sb-cf-sides sb-dup-sides">
        {conflict.entities.map((entity, i) => (
          <EntityCard key={entity.id} entity={entity} suggested={i === 0} />
        ))}
      </div>

      <div className="sb-dup-shared">
        <div className="sb-detail-kicker">Connected to both</div>
        {conflict.sharedNeighbours.length === 0 ? (
          <p className="sb-faint sb-dup-shared-none">
            No entity is connected to both. The resemblance is in the names alone.
          </p>
        ) : (
          <div className="sb-dup-chips">
            {conflict.sharedNeighbours.map((n) => (
              <Link key={n.id} href={worldUrl({ entity: n.id })} className="sb-dup-chip">
                {n.name} <span className="sb-faint">{n.entityType}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {conflict.dismissed ? (
        <>
          <div className="sb-cf-actions">
            <DismissButton conflictId={conflict.id} dismissed label="Reopen" />
          </div>
          <div className="sb-cf-note">
            <strong>Not the same.</strong> You said these are two different things. They stay out of
            the inbox; reopen to decide again.
          </div>
        </>
      ) : (
        // Keyed by the pair, so a stale preview from another pair can never show.
        <MergeActions
          key={conflict.key}
          conflictId={conflict.id}
          entities={[pick(a), pick(b)]}
          next={next}
        />
      )}
    </div>
  )
}

function pick({ id, name, entityType }: DuplicateEntity) {
  return { id, name, entityType }
}

function EntityLink({ entity }: { entity: DuplicateEntity }) {
  return (
    <Link href={worldUrl({ entity: entity.id })} className="sb-entity-link">
      {entity.name}
    </Link>
  )
}

/** One of the pair, as the World would describe it. */
function EntityCard({ entity, suggested }: { entity: DuplicateEntity; suggested: boolean }) {
  const docs = entity.documents

  return (
    <section className="sb-cf-side" aria-label={entity.name}>
      <div className="sb-cf-side-head">
        <span className="tag tag-neutral">{entity.canonicity === 'canon' ? 'Canon' : 'Draft'}</span>
        <span className="tag tag-neutral">{provenanceLabel(entity.createdBy)}</span>
        {suggested && <span className="sb-dup-suggested">Suggested to keep</span>}
      </div>

      <div className="sb-cf-side-value">
        <EntityLink entity={entity} /> <span className="sb-claim-type">{entity.entityType}</span>
      </div>

      <dl className="sb-dup-facts">
        <dt>Also called</dt>
        <dd>
          {entity.nameVariants.length > 0 ? (
            entity.nameVariants.join(', ')
          ) : (
            <span className="sb-faint">no other names</span>
          )}
        </dd>

        <dt>Claims</dt>
        <dd>
          {entity.claimCount === 0
            ? 'none'
            : `${entity.claimCount} ${entity.claimCount === 1 ? 'claim' : 'claims'}`}
        </dd>

        <dt>Read from</dt>
        <dd>
          {docs.length === 0 ? (
            <span className="sb-faint">no document</span>
          ) : (
            <ul className="sb-dup-docs">
              {docs.map((d) => (
                <li key={d.id}>{d.name}</li>
              ))}
            </ul>
          )}
        </dd>
      </dl>
    </section>
  )
}
