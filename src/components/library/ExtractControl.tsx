'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { LocalTime } from '@/components/shared/LocalTime'
import { isProviderSettingsFailure, type RunRefusal, type RunSummary } from '@/lib/extraction/codes'

/**
 * The Extract button, and everything it says while and after it runs.
 *
 * ## The progress is real, and so it is only time
 *
 * The run is one long POST: export, one model call, perhaps a repair, then the
 * write (see the route). Nothing inside it reports back mid-flight, so the only
 * true thing to show is that it is still going and for how long. A percentage
 * bar would be invented, and a bar that sits at 90% for two minutes teaches a
 * person to distrust every other number on the screen.
 *
 * ## What it says afterwards
 *
 * The counts straight from the run — new, already present, reverse-direction,
 * new entities, dropped — and then `router.refresh()`, so the server-rendered
 * parts of the pane (the claim count, the dropped-claims list, the status tag)
 * catch up to the same run. Every failure names the thing to do about it;
 * the ones that are the provider settings' fault link to them.
 */

type Phase =
  | { kind: 'idle' }
  | { kind: 'running'; since: number }
  | { kind: 'done'; run: RunSummary }
  | { kind: 'refused'; error: RunRefusal | 'malformed' | 'unexpected'; message: string }
  | { kind: 'lost' }

type ApiResponse =
  | { ok: true; run: RunSummary }
  | { ok: false; error: RunRefusal | 'malformed'; message: string; startedAt?: string }

export function ExtractControl({
  documentId,
  extractedBefore,
  providerConfigured,
  runningSince,
}: {
  documentId: string
  extractedBefore: boolean
  providerConfigured: boolean
  /** ISO time a run already in flight started — another tab, or a reload mid-run. */
  runningSince: string | null
}) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })

  const running = phase.kind === 'running'
  const elsewhere = !running && phase.kind !== 'done' && runningSince !== null

  const extract = async () => {
    setPhase({ kind: 'running', since: Date.now() })

    let body: ApiResponse | null
    try {
      const res = await fetch(`/api/documents/${documentId}/extract`, { method: 'POST' })
      body = (await res.json().catch(() => null)) as ApiResponse | null
    } catch {
      // The connection dropped, not necessarily the run: the server may well
      // still be working, and will record what it finds either way.
      setPhase({ kind: 'lost' })
      router.refresh()
      return
    }

    if (body?.ok) setPhase({ kind: 'done', run: body.run })
    else if (body) setPhase({ kind: 'refused', error: body.error, message: body.message })
    else {
      setPhase({
        kind: 'refused',
        error: 'unexpected',
        message: 'The server returned something unexpected. Reload to see whether the run was recorded.',
      })
    }
    router.refresh()
  }

  if (!providerConfigured && phase.kind === 'idle') {
    return (
      <div className="sb-x-box sb-x-box--warn">
        <p>Extraction needs an inference provider — Stone Brain has no model of its own.</p>
        <p>
          <Link href="/settings">Configure one in Settings</Link>
        </p>
      </div>
    )
  }

  return (
    <>
      {running && <Progress since={phase.since} />}

      {elsewhere && (
        <div className="sb-x-box">
          <div className="sb-x-progress">
            <i className="ph ph-circle-notch sb-x-spin" />
            <span>An extraction is already running on this document.</span>
          </div>
          {/* In the viewer's own timezone, which the server cannot know — see
              LocalTime for why a hydration exemption was not enough. */}
          <p className="sb-x-note" style={{ marginTop: 6 }}>
            Started at <LocalTime value={runningSince!} options={{ timeStyle: 'short' }} />. Its
            result appears here when it lands.
          </p>
        </div>
      )}

      {phase.kind === 'done' && <Result run={phase.run} />}
      {phase.kind === 'refused' && <Refused error={phase.error} message={phase.message} />}
      {phase.kind === 'lost' && (
        <div className="sb-x-box sb-x-box--warn">
          <p>
            The request did not come back. The extraction may still have finished on the server —
            reload in a minute to see what was recorded.
          </p>
        </div>
      )}

      <button
        type="button"
        className="btn btn-primary btn-block sb-detail-btn"
        onClick={() => void extract()}
        disabled={running || elsewhere}
      >
        <i className={running ? 'ph ph-circle-notch sb-x-spin' : 'ph-bold ph-sparkle'} />
        {running ? 'Extracting…' : extractedBefore ? 'Re-extract claims' : 'Extract claims'}
      </button>
      {elsewhere && (
        <button
          type="button"
          className="btn btn-ghost btn-block sb-btn-sm"
          style={{ marginTop: 6 }}
          onClick={() => router.refresh()}
        >
          Check again
        </button>
      )}
    </>
  )
}

/**
 * Elapsed time, ticking. The copy sets the expectation the measurements
 * support (§4: 7–8s typical, a few minutes in the worst case) so that a long
 * wait reads as normal rather than as a hang.
 */
function Progress({ since }: { since: number }) {
  const [now, setNow] = useState(since)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const seconds = Math.max(0, Math.floor((now - since) / 1000))
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

  return (
    <div className="sb-x-box" role="status" aria-live="polite">
      <div className="sb-x-progress">
        <i className="ph ph-circle-notch sb-x-spin" />
        <span>Reading the document and asking the model…</span>
        <span className="sb-x-elapsed">{clock}</span>
      </div>
      <p className="sb-x-note" style={{ marginTop: 6 }}>
        {seconds < 45
          ? 'Usually under a minute. Closing this pane does not cancel it.'
          : 'Long documents, or a slow provider, can take a few minutes. Still working.'}
      </p>
    </div>
  )
}

function Result({ run }: { run: RunSummary }) {
  if (run.status === 'failed' && run.failure) {
    const toSettings = isProviderSettingsFailure(run.failure.code)
    return (
      <div className="sb-x-box sb-x-box--bad" role="alert">
        <p>{run.failure.message}</p>
        {toSettings && (
          <p>
            <Link href="/settings">Check the provider in Settings</Link>
          </p>
        )}
        {run.failure.code === 'drive_disconnected' && (
          <p>
            <Link href="/settings">Drive connection in Settings</Link>
          </p>
        )}
        <p className="sb-x-note">Nothing was written. The attempt is recorded on this document.</p>
      </div>
    )
  }

  const seconds = Math.max(1, Math.round(run.durationMs / 1000))
  const nothing = run.claimsExtracted === 0 && run.dropped === 0

  return (
    <div className="sb-x-box sb-x-box--ok" role="status">
      <p>
        {nothing
          ? `Done in ${seconds}s. The model found nothing here the vocabulary can express.`
          : `Done in ${seconds}s.`}
      </p>
      {!nothing && (
        <dl className="sb-x-counts">
          <dt>New claims</dt>
          <dd>{run.claimsCreated}</dd>
          <dt>Already in the graph</dt>
          <dd>{run.claimsAlreadyPresent}</dd>
          <dt>Reverse-direction claims</dt>
          <dd>{run.inversesCreated}</dd>
          <dt>New draft entities</dt>
          <dd>{run.entitiesCreated}</dd>
          <dt>Dropped</dt>
          <dd>{run.dropped}</dd>
        </dl>
      )}
      {run.dropped > 0 && (
        <p className="sb-x-note" style={{ marginTop: 6 }}>
          Dropped claims are listed below with the reason each was refused.
        </p>
      )}
      {run.proposalsFiled > 0 && (
        <p className="sb-x-note">
          {run.proposalsFiled === 1
            ? 'The model proposed one predicate the vocabulary lacks'
            : `The model proposed ${run.proposalsFiled} predicates the vocabulary lacks`}{' '}
          — <Link href="/settings#proposals">review in Settings</Link>.
        </p>
      )}
    </div>
  )
}

function Refused({
  error,
  message,
}: {
  error: RunRefusal | 'malformed' | 'unexpected'
  message: string
}) {
  return (
    <div className={`sb-x-box ${error === 'busy' ? 'sb-x-box--warn' : 'sb-x-box--bad'}`} role="alert">
      <p>{message}</p>
      {error === 'no_provider' && (
        <p>
          <Link href="/settings">Configure a provider in Settings</Link>
        </p>
      )}
    </div>
  )
}
