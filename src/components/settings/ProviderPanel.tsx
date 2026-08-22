'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Modal } from '@/components/shared/Modal'
import type { ProviderHealth } from '@/db/schema'
import type { ProviderStatus } from '@/lib/llm/provider'

/**
 * Where a person tells Stone Brain how to reach a model.
 *
 * Decisions §11 made this bring-your-own-provider, which means this panel is
 * the gate on everything in Phase 2B: no key, no extraction. It is deliberately
 * *not* part of signup — Phase 1 needs no model at all, so the ask arrives here
 * and, later, at the point where someone first presses Extract.
 *
 * Three fields, because a provider is three facts: where it is, who we are to
 * it, and which model to run. The base URL takes presets rather than a
 * dropdown of providers, so "any OpenAI-compatible endpoint" stays true while
 * the common cases are one click. The model ID is free text on purpose: it is
 * a provider-specific string, and no list we could offer would be right for a
 * local runtime.
 */

/** Filled into the base URL by one click; the field stays editable after. */
const PRESETS: { label: string; url: string }[] = [
  { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
  { label: 'OpenAI', url: 'https://api.openai.com/v1' },
  { label: 'Together', url: 'https://api.together.xyz/v1' },
  { label: 'Ollama', url: 'http://localhost:11434/v1' },
]

const HEALTH_COPY: Record<ProviderHealth, { label: string; tone: 'ok' | 'bad' | 'warn' | 'idle' }> =
  {
    ok: { label: 'Connected', tone: 'ok' },
    unauthorized: { label: 'Key rejected', tone: 'bad' },
    payment_required: { label: 'Out of credit', tone: 'bad' },
    rate_limited: { label: 'Rate limited', tone: 'warn' },
    model_rejected: { label: 'Model refused', tone: 'bad' },
    unreachable: { label: 'Could not reach provider', tone: 'bad' },
    unknown: { label: 'Not yet checked', tone: 'idle' },
  }

type ApiResponse = { ok?: boolean; status?: ProviderStatus; error?: string }

export function ProviderPanel({ initial }: { initial: ProviderStatus | null }) {
  const router = useRouter()

  /*
   * Held in state rather than read from the server on every change, because a
   * save returns the fresh probe result in its own response — showing it
   * immediately, and refreshing the server data behind it, beats making the
   * person wait for a round trip to see the answer they just asked for.
   */
  const [status, setStatus] = useState(initial)
  const [open, setOpen] = useState(false)
  const [checking, setChecking] = useState(false)

  /*
   * Re-runs the probe against what is already stored, changing nothing else.
   * It exists because two of the failure states are not the user's fault and
   * not permanent — a rate limit clears, a provider comes back — and without
   * this the only way to find out would be to re-open the form and re-save a
   * configuration that was never wrong.
   */
  const recheck = async () => {
    setChecking(true)
    const res = await fetch('/api/provider', { method: 'PATCH' })
    const body = (await res.json().catch(() => null)) as ApiResponse | null
    setChecking(false)
    if (body?.ok && body.status) setStatus(body.status)
  }

  return (
    <>
      <div className="sb-panel">
        <div className="sb-kicker">Inference</div>
        <div className="sb-grant">
          <i className="ph ph-sparkle" />
          <div style={{ minWidth: 0 }}>
            <div className="sb-grant-title">{status ? status.modelId : 'No provider configured'}</div>
            <div className="sb-grant-note">
              {status ? (
                <>
                  <span className="sb-provider-url">{status.baseUrl}</span> · key ····
                  {status.keyLast4}
                </>
              ) : (
                'Stone Brain has no model of its own. Reading claims out of a document needs an OpenAI-compatible endpoint and a key of yours.'
              )}
            </div>
            {status && <HealthLine status={status} />}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, paddingBottom: 14 }}>
          <button
            type="button"
            className={status ? 'btn btn-secondary' : 'btn btn-primary'}
            onClick={() => setOpen(true)}
          >
            {status ? 'Edit provider' : 'Configure provider'}
          </button>
          {status && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={recheck}
              disabled={checking}
            >
              {checking ? 'Checking…' : 'Re-check'}
            </button>
          )}
        </div>
      </div>

      <Modal
        open={open}
        title={status ? 'Edit inference provider' : 'Configure inference provider'}
        icon="ph ph-sparkle"
        wide
        showClose
        /* An editor holds a half-typed key; a stray click must not take it. */
        dismissOnScrim={false}
        onClose={() => setOpen(false)}
      >
        <ProviderForm
          status={status}
          onSaved={(next) => {
            setStatus(next)
            router.refresh()
          }}
          onRemoved={() => {
            setStatus(null)
            setOpen(false)
            router.refresh()
          }}
          onCancel={() => setOpen(false)}
        />
      </Modal>
    </>
  )
}

function HealthLine({ status }: { status: ProviderStatus }) {
  const { label, tone } = HEALTH_COPY[status.health]

  return (
    <div className="sb-provider-health" data-tone={tone}>
      <span className="sb-provider-dot" />
      <span>
        {label}
        {status.healthDetail ? ` — ${status.healthDetail}` : ''}
      </span>
    </div>
  )
}

function ProviderForm({
  status,
  onSaved,
  onRemoved,
  onCancel,
}: {
  status: ProviderStatus | null
  onSaved: (status: ProviderStatus) => void
  onRemoved: () => void
  onCancel: () => void
}) {
  const [baseUrl, setBaseUrl] = useState(status?.baseUrl ?? PRESETS[0]!.url)
  const [modelId, setModelId] = useState(status?.modelId ?? '')
  /*
   * Always starts empty, even when a key is on file. The stored key never
   * reaches the browser, so there is nothing truthful to prefill; an empty
   * field that says what happens if you leave it empty is the honest version.
   */
  const [apiKey, setApiKey] = useState('')
  const [reveal, setReveal] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null)

  const trimmedUrl = baseUrl.trim()
  const trimmedModel = modelId.trim()
  const keyRequired = !status
  const canSave = trimmedUrl !== '' && trimmedModel !== '' && (!keyRequired || apiKey.trim() !== '')

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setBusy('save')

    const res = await fetch('/api/provider', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseUrl: trimmedUrl,
        modelId: trimmedModel,
        // Omitted, not sent empty: the server reads an omission as "keep the
        // key on file", which is what an untouched field means.
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      }),
    })

    const body = (await res.json().catch(() => null)) as ApiResponse | null
    setBusy(null)

    if (!body?.ok || !body.status) {
      setError(body?.error ?? 'Could not save those settings.')
      return
    }

    setApiKey('')
    onSaved(body.status)
  }

  const remove = async () => {
    setError(null)
    setBusy('remove')
    const res = await fetch('/api/provider', { method: 'DELETE' })
    setBusy(null)
    if (!res.ok) {
      setError('Could not remove the provider.')
      return
    }
    onRemoved()
  }

  return (
    <form className="sb-claim-form" onSubmit={submit}>
      <label className="sb-field">
        <span>Base URL</span>
        <input
          className="input"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://openrouter.ai/api/v1"
          spellCheck={false}
          autoComplete="off"
          autoFocus
          required
        />
        <div className="sb-preset-row">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className={`sb-preset${trimmedUrl === preset.url ? ' sb-preset--on' : ''}`}
              onClick={() => setBaseUrl(preset.url)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <p className="sb-field-hint">
          Anything that speaks the OpenAI chat-completions API. Include the version suffix if the
          provider uses one — the presets are shortcuts, not a list of what is supported.
        </p>
      </label>

      <label className="sb-field">
        <span>API key</span>
        <div className="sb-key-row">
          <input
            className="input"
            type={reveal ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={status ? `Keeping the key ending ${status.keyLast4}` : 'sk-…'}
            spellCheck={false}
            autoComplete="off"
            required={keyRequired}
          />
          <button
            type="button"
            className="btn btn-secondary sb-btn-sm"
            onClick={() => setReveal((v) => !v)}
            aria-label={reveal ? 'Hide the key' : 'Show the key'}
            title={reveal ? 'Hide' : 'Show'}
          >
            <i className={reveal ? 'ph ph-eye-slash' : 'ph ph-eye'} />
          </button>
        </div>
        <p className="sb-field-hint">
          Encrypted before it is stored, and never sent to the browser again — not even here.
          {status ? ' Leave this blank to keep the key already on file.' : ''}
        </p>
      </label>

      <label className="sb-field">
        <span>Model ID</span>
        <input
          className="input"
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          placeholder="anthropic/claude-sonnet-5"
          spellCheck={false}
          autoComplete="off"
          required
        />
        <p className="sb-field-hint">
          Exactly as your provider spells it. Every claim records the model that produced it, so
          changing this does not rewrite what has already been extracted.
        </p>
      </label>

      <p className="sb-claim-note">
        Saving sends one tiny request to check all three fields at once. A failed check does not
        discard what you typed — it just says which part to look at.
      </p>

      {error && <p className="sb-form-error">{error}</p>}

      <div className="sb-modal-actions">
        {status && (
          <button
            type="button"
            className="btn btn-ghost sb-btn-sm sb-btn-danger"
            /* Pushed away from Save and Cancel: it is the one button here that
               throws something away, and it should not sit under the thumb. */
            style={{ marginRight: 'auto' }}
            onClick={remove}
            disabled={busy !== null}
          >
            {busy === 'remove' ? 'Removing…' : 'Remove'}
          </button>
        )}
        <button
          type="button"
          className="btn btn-secondary sb-btn-sm"
          onClick={onCancel}
          disabled={busy !== null}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn-primary sb-btn-sm"
          disabled={busy !== null || !canSave}
        >
          {busy === 'save' ? 'Checking…' : 'Save and verify'}
        </button>
      </div>
    </form>
  )
}
