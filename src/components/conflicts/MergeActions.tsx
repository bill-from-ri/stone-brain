'use client'

import type { Route } from 'next'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { MergePlan } from '@/lib/duplicates/types'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DismissButton, useAction, type Outcome } from './ConflictActions'

/**
 * Merging a possible duplicate: choose which entity survives, see what the
 * merge will do, then do it — or say the two are not the same.
 *
 * The preview is the server's own plan (GET /api/entities/merge), the same
 * computation the merge runs, fetched again whenever the choice of survivor
 * changes — because it does change: a cross-type merge can recast claims one
 * way round and be blocked the other. Nothing is guessed here. While the plan
 * has blockers, Merge is unavailable and the blockers are listed with their
 * reasons, so the person knows which claims to fix first.
 *
 * Merging deletes the dropped entity and cannot be undone, so it confirms, on
 * the ConfirmDialog every destructive action uses. After it the page moves on
 * to the next conflict rather than refreshing in place: this pair, and any
 * other pair the dropped entity was in, no longer exist.
 */

type Entity = { id: string; name: string; entityType: string }

type Preview = { ok: true; plan: MergePlan } | { ok: false; error: string }

const FALLBACK = 'Could not work out what the merge would do.'

async function fetchPlan(keep: string, drop: string, signal: AbortSignal): Promise<Preview> {
  const query = new URLSearchParams({ keep, drop })
  const res = await fetch(`/api/entities/merge?${query}`, { signal })
  const json = (await res.json().catch(() => null)) as
    | { ok?: boolean; plan?: MergePlan; error?: string }
    | null
  return json?.ok && json.plan ? { ok: true, plan: json.plan } : { ok: false, error: json?.error ?? FALLBACK }
}

export function MergeActions({
  conflictId,
  entities,
  next,
}: {
  conflictId: string
  /** The suggested survivor first, as the check orders them. */
  entities: [Entity, Entity]
  next: Route
}) {
  const router = useRouter()
  const [keepId, setKeepId] = useState(entities[0].id)
  const keep = entities.find((e) => e.id === keepId)!
  const drop = entities.find((e) => e.id !== keepId)!
  const choice = `${keep.id}|${drop.id}`

  // One preview per direction, kept: switching back is instant, and a preview
  // only ever lands under the choice it was asked for, so a slow answer to an
  // old choice cannot overwrite the current one.
  const [previews, setPreviews] = useState<Record<string, Preview>>({})
  const preview = previews[choice]

  useEffect(() => {
    if (previews[choice]) return
    const controller = new AbortController()
    fetchPlan(keep.id, drop.id, controller.signal)
      .then((p) => {
        if (!controller.signal.aborted) setPreviews((all) => ({ ...all, [choice]: p }))
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        console.error(err)
        setPreviews((all) => ({ ...all, [choice]: { ok: false, error: FALLBACK } }))
      })
    return () => controller.abort()
  }, [choice, keep.id, drop.id, previews])

  const [confirming, setConfirming] = useState(false)
  const { busy, error, run } = useAction()

  const plan = preview?.ok ? preview.plan : null
  const blocked = plan !== null && plan.blockers.length > 0
  const canMerge = plan !== null && !blocked && !busy

  const merge = async (): Promise<Outcome> => {
    const res = await fetch('/api/entities/merge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keepId: keep.id, dropId: drop.id }),
    }).catch(() => null)
    const json = (await res?.json().catch(() => null)) as
      | { ok?: boolean; plan?: MergePlan; error?: string }
      | null
    if (json?.ok) return { ok: true }
    // A 409 carries the plan as it now stands — something changed since the
    // preview — so show that rather than the preview that was wrong.
    if (json?.plan) {
      const fresh = json.plan
      setPreviews((all) => ({ ...all, [choice]: { ok: true, plan: fresh } }))
    }
    setConfirming(false)
    return { ok: false, error: json?.error ?? 'The merge did not go through. Try again.' }
  }

  return (
    <div className="sb-dup-merge">
      <fieldset className="sb-dup-choice" disabled={busy}>
        <legend className="sb-detail-kicker">Keep</legend>
        {entities.map((entity) => (
          <label
            key={entity.id}
            className={`sb-dup-option${entity.id === keepId ? ' sb-dup-option--on' : ''}`}
          >
            <input
              type="radio"
              name={`keep-${conflictId}`}
              value={entity.id}
              checked={entity.id === keepId}
              onChange={() => setKeepId(entity.id)}
            />
            <span>
              {entity.name} <span className="sb-faint">{entity.entityType}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="sb-dup-preview" aria-live="polite">
        {!preview ? (
          <p className="sb-faint">Working out what the merge would do…</p>
        ) : !preview.ok ? (
          <p className="sb-cf-error">
            {preview.error}{' '}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() =>
                setPreviews(({ [choice]: _failed, ...rest }) => rest)
              }
            >
              Try again
            </button>
          </p>
        ) : (
          <PlanSummary plan={preview.plan} />
        )}
      </div>

      <div className="sb-cf-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canMerge}
          title={blocked ? 'Fix the claims listed above first' : undefined}
          onClick={() => setConfirming(true)}
        >
          <i className="ph ph-git-merge" />
          Merge into {keep.name}
        </button>
        <span className="sb-cf-actions-sep">·</span>
        <DismissButton conflictId={conflictId} dismissed={false} label="Not the same" />
      </div>
      {error && !confirming && <p className="sb-cf-error">{error}</p>}

      <ConfirmDialog
        open={confirming}
        title={`Merge “${drop.name}” into “${keep.name}”?`}
        confirmLabel="Merge"
        busy={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={() => run(merge, () => router.push(next))}
        body={
          <p>
            {drop.name} is deleted. Its claims move onto {keep.name}, and its name is kept as one of{' '}
            {keep.name}’s variants.
          </p>
        }
      >
        {error && <p className="sb-cf-error">{error}</p>}
      </ConfirmDialog>
    </div>
  )
}

/** What the merge will do, as the plan says it. */
function PlanSummary({ plan }: { plan: MergePlan }) {
  const { keep, drop } = plan
  const claims = (n: number) => `${n} ${n === 1 ? 'claim' : 'claims'}`

  return (
    <>
      <ul className="sb-dup-plan">
        <li>
          {plan.repointed === 0
            ? `No claims to move from ${drop.name}.`
            : `Moves ${claims(plan.repointed)} from ${drop.name} onto ${keep.name}.`}
        </li>
        {plan.folded > 0 && (
          <li>
            Folds {claims(plan.folded)} {keep.name} already has into its own, keeping their
            citations.
          </li>
        )}
        {plan.variantsAdded.length > 0 && (
          <li>
            Adds {plan.variantsAdded.map((v) => `“${v}”`).join(', ')} to {keep.name}’s other names.
          </li>
        )}
        <li>Deletes {drop.name}.</li>
      </ul>

      {plan.recast.length > 0 && (
        <div className="sb-dup-recast">
          <div className="sb-detail-kicker">
            Changed to fit a {keep.entityType}
          </div>
          <ul className="sb-dup-plan">
            {plan.recast.map((r) => (
              <li key={r.claimId}>
                {r.sentence}{' '}
                <span className="sb-faint">
                  ({r.from} → {r.to})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan.blockers.length > 0 && (
        <div className="sb-dup-blockers" role="note">
          <strong>
            {plan.blockers.length === 1
              ? `One claim stops this merge.`
              : `${plan.blockers.length} claims stop this merge.`}
          </strong>{' '}
          A {keep.entityType} cannot take {plan.blockers.length === 1 ? 'it' : 'them'} as{' '}
          {plan.blockers.length === 1 ? 'it stands' : 'they stand'}. Edit or delete{' '}
          {plan.blockers.length === 1 ? 'it' : 'them'} in the World, or try keeping the other one.
          <ul className="sb-dup-plan">
            {plan.blockers.map((b) => (
              <li key={b.claimId}>
                {b.sentence} <span className="sb-dup-blocker-why">— {b.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
