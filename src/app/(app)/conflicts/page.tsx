import type { Metadata } from 'next'
import { AppHeader } from '@/components/shell/AppHeader'
import { ConflictInbox, inboxHref, type InboxView } from '@/components/conflicts/ConflictInbox'
import {
  ValueConflictView,
  VanishedSourceView,
  type EditSupport,
} from '@/components/conflicts/ConflictView'
import { DuplicateView } from '@/components/conflicts/DuplicateView'
import { EmptyState } from '@/components/shared/RecordTable'
import {
  getClaims,
  getEntities,
  getEntityTypes,
  getPredicates,
  getSignatures,
} from '@/db/queries/claims'
import { getConflicts, type Conflict } from '@/db/queries/conflicts'
import { requireReady } from '@/lib/auth/guard'
import '@/styles/conflicts.css'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Conflicts' }

/**
 * Conflicts: everywhere the graph disagrees with itself, and the one place to
 * settle it.
 *
 * Three kinds, kept visibly apart because they ask different questions. A
 * *contradiction* is two claims giving a single-valued predicate different
 * answers at the same time — a question about the world. A *missing source*
 * is a claim whose every document has left the Library (ADR §7a) — a question
 * about whether to go on believing it. A *possible duplicate* is two entities
 * whose names say they are one thing — a question about whether to merge them.
 *
 * Nothing on this screen is stored except a dismissal. The list is derived
 * from the claims on every render, so resolving a conflict is just changing a
 * claim — keep a side, fix a date — and the conflict is gone on the refresh
 * because it is no longer true, not because something marked it closed.
 *
 * Selection is `?c=` and the tab is `?view=dismissed`. A link to a dismissed
 * conflict (the World's table can carry one) opens the tab it is on rather
 * than an empty pane.
 */
export default async function ConflictsPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; view?: string }>
}) {
  const session = await requireReady()
  const userId = session.user.id
  const params = await searchParams

  const conflicts = await getConflicts(userId)
  const open = conflicts.filter((c) => !c.dismissed)
  const dismissed = conflicts.filter((c) => c.dismissed)

  const requested = params.c ? conflicts.find((c) => c.id === params.c) : undefined
  const view: InboxView = requested
    ? requested.dismissed ? 'dismissed' : 'open'
    : params.view === 'dismissed' ? 'dismissed' : 'open'
  const listed = view === 'dismissed' ? dismissed : open
  const selected = requested ?? listed[0] ?? null

  return (
    <>
      <AppHeader />
      <div className="sb-conflicts">
        <ConflictInbox
          conflicts={listed}
          view={view}
          selectedId={selected?.id ?? null}
          openCount={open.length}
          dismissedCount={dismissed.length}
        />
        <div className="sb-cf-main">
          {selected ? (
            <Selected userId={userId} conflict={selected} listed={listed} view={view} />
          ) : view === 'open' ? (
            <EmptyState
              icon="ph ph-check-circle"
              title="Your world is consistent."
              note={
                <>
                  No two claims disagree, every extracted claim still has a document behind it, and
                  no two entities look like one thing under two names.
                  {dismissed.length > 0 &&
                    ` ${dismissed.length} dismissed ${dismissed.length === 1 ? 'conflict is' : 'conflicts are'} under Dismissed.`}
                </>
              }
            />
          ) : (
            <EmptyState
              icon="ph ph-eye-slash"
              title="Nothing dismissed."
              note="A conflict you mark as not a conflict is kept here, where you can reopen it."
            />
          )}
        </div>
      </div>
    </>
  )
}

async function Selected({
  userId,
  conflict,
  listed,
  view,
}: {
  userId: string
  conflict: Conflict
  listed: Conflict[]
  view: InboxView
}) {
  const index = listed.findIndex((c) => c.id === conflict.id)
  const position = {
    index: Math.max(index, 0),
    total: Math.max(listed.length, 1),
    prev: index > 0 ? inboxHref(view, listed[index - 1]!.id) : null,
    next: index >= 0 && index < listed.length - 1 ? inboxHref(view, listed[index + 1]!.id) : null,
  }

  if (conflict.kind === 'vanished_source') {
    return <VanishedSourceView conflict={conflict} position={position} />
  }

  if (conflict.kind === 'duplicate') {
    // After a merge this pair is gone: go on to the next item, or back to the
    // tab itself, which opens whatever is first.
    return (
      <DuplicateView conflict={conflict} position={position} next={position.next ?? inboxHref(view)} />
    )
  }

  /*
   * Editing a side reuses the World's claim editor, which wants the claim as a
   * ClaimRow and the vocabulary for its pickers. Fetched only for the conflict
   * actually open, in one parallel batch; the three vocabulary reads are cached
   * across requests (see db/queries/claims.ts).
   */
  const [subjectClaims, entities, entityTypes, predicates, signatures] = await Promise.all([
    getClaims(userId, { entityId: conflict.subject.id }),
    getEntities(userId),
    getEntityTypes(),
    getPredicates(),
    getSignatures(),
  ])

  const edit: EditSupport = {
    claims: new Map(subjectClaims.map((c) => [c.id, c])),
    entities: entities.map(({ id, name, entityType }) => ({ id, name, entityType })),
    entityTypes,
    predicates,
    signatures,
  }

  return <ValueConflictView conflict={conflict} position={position} edit={edit} />
}
