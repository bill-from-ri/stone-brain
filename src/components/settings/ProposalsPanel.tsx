'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { ProposalGroup } from '@/db/queries/extraction'
import type { ProposalStatus } from '@/db/schema'

/**
 * The vocabulary proposals queue (implementation plan §6; ontology-design.md,
 * "How the vocabulary grows").
 *
 * When a document states something no predicate can express, the extractor
 * files a proposal here instead of forcing a near-synonym into the graph. This
 * panel is where a person reads them and decides.
 *
 * ## What "Promote" honestly means
 *
 * The vocabulary is global and curated (ADR §15), so a person in Settings
 * cannot add a predicate to it — and a button that looked as if it did would
 * be the worst kind of copy, because the next extraction would quietly prove
 * it wrong. Promoting records the decision that the registry *should* grow;
 * the growing is a registry edit and a re-seed by whoever maintains it. The
 * panel says exactly that, in the place the decision is made.
 *
 * Proposals are grouped by name, so "four documents wanted `trades_with`" reads
 * as one card with four quotes — that count is the signal of where the
 * ontology is thin — and a decision applies to the name.
 */
export function ProposalsPanel({
  open,
  decided,
}: {
  open: ProposalGroup[]
  decided: ProposalGroup[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const decide = async (group: ProposalGroup, status: ProposalStatus) => {
    setBusy(group.name)
    setError(null)
    const res = await fetch(`/api/proposals/${group.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    }).catch(() => null)
    const body = (await res?.json().catch(() => null)) as { ok?: boolean; error?: string } | null
    setBusy(null)
    if (!body?.ok) {
      setError(body?.error ?? `Could not update ${group.name}. Try again.`)
      return
    }
    router.refresh()
  }

  return (
    <div className="sb-panel" id="proposals">
      <div className="sb-kicker">Vocabulary proposals</div>
      <div className="sb-grant">
        <i className="ph ph-git-pull-request" />
        <div>
          <div className="sb-grant-title">
            {open.length === 0
              ? 'Nothing waiting'
              : `${open.length} open ${open.length === 1 ? 'proposal' : 'proposals'}`}
          </div>
          <div className="sb-grant-note">
            When a document states a relationship or attribute the vocabulary has no predicate for,
            extraction files it here instead of forcing a near-synonym. The vocabulary is shared
            and curated, so promoting records that it should gain this predicate — a maintainer
            then adds it to the registry and re-seeds. Until that happens the extractor still
            cannot write it, and nothing in your graph changes.
          </div>
        </div>
      </div>

      {error && (
        <p className="sb-form-error" style={{ marginBottom: 10 }}>
          {error}
        </p>
      )}

      {open.length > 0 && (
        <div className="sb-x-proposals">
          {open.map((group) => (
            <ProposalCard
              key={group.name}
              group={group}
              busy={busy === group.name}
              disabled={busy !== null}
              onDecide={(status) => void decide(group, status)}
            />
          ))}
        </div>
      )}

      {decided.length > 0 && (
        <details className="sb-x-more" style={{ paddingBottom: 12 }}>
          <summary>
            {decided.length} decided {decided.length === 1 ? 'proposal' : 'proposals'}
          </summary>
          <div>
            {decided.map((group) => (
              <div key={group.name} className="sb-x-decided">
                <span className="sb-x-proposal-name">{group.name}</span>
                <span className={group.status === 'promoted' ? 'tag sb-tag-ok' : 'tag tag-neutral'}>
                  {group.status === 'promoted' ? 'Promoted' : 'Rejected'}
                </span>
                {group.decidedAt && (
                  <span className="sb-x-decided-when">{formatDay(group.decidedAt)}</span>
                )}
                <button
                  type="button"
                  className="btn btn-ghost sb-btn-sm"
                  onClick={() => void decide(group, 'open')}
                  disabled={busy !== null}
                >
                  {busy === group.name ? 'Reopening…' : 'Reopen'}
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function ProposalCard({
  group,
  busy,
  disabled,
  onDecide,
}: {
  group: ProposalGroup
  busy: boolean
  disabled: boolean
  onDecide: (status: ProposalStatus) => void
}) {
  const documents = new Set(group.sightings.map((s) => s.documentId ?? s.documentName)).size

  return (
    <div className="sb-x-proposal">
      <div className="sb-x-proposal-head">
        <span className="sb-x-proposal-name">{group.name}</span>
        <span className="sb-x-proposal-sig">{signature(group)}</span>
        {documents > 1 && <span className="tag tag-neutral">{documents} documents</span>}
      </div>
      <p className="sb-x-proposal-desc">{group.description}</p>

      {group.sightings.map((s) => (
        <div key={s.id} className="sb-x-sighting">
          {s.quote && <div className="sb-x-quote">“{s.quote}”</div>}
          <div className="sb-x-sighting-source">
            {s.documentName ?? 'A document no longer in the library'}
            {s.paragraphIndex !== null && ` · ¶ ${s.paragraphIndex}`}
            {s.exampleSubject && (
              <>
                {' · e.g. '}
                {s.exampleSubject}
                {s.exampleObject ? ` → ${s.exampleObject}` : ''}
              </>
            )}
          </div>
        </div>
      ))}

      <div className="sb-x-actions">
        <button
          type="button"
          className="btn btn-secondary sb-btn-sm"
          onClick={() => onDecide('promoted')}
          disabled={disabled}
          title="Record that the vocabulary should gain this predicate."
        >
          {busy ? 'Saving…' : 'Promote'}
        </button>
        <button
          type="button"
          className="btn btn-ghost sb-btn-sm"
          onClick={() => onDecide('rejected')}
          disabled={disabled}
          title="Record that the vocabulary should not have this predicate. It will not be proposed again."
        >
          Reject
        </button>
      </div>
    </div>
  )
}

function signature(group: ProposalGroup): string {
  if (!group.subjectType) return ''
  return group.objectType
    ? `${group.subjectType} → ${group.objectType}`
    : `attribute of ${group.subjectType}`
}

/** Fixed locale and UTC, so the server render and hydration agree. */
function formatDay(date: Date | string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(date))
}
