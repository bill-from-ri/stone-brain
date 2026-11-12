'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { verificationTarget } from '@/lib/documents/status'

/**
 * "Mark as verified", and the way back.
 *
 * Verified is the one status a person sets rather than the pipeline, so it is a
 * deliberate button rather than something inferred from, say, every claim
 * being promoted to canon. It is offered only once there is an extraction to
 * vouch for (see `verificationTarget`).
 */
export function VerifyButton({ documentId, status }: { documentId: string; status: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const verified = status === 'verified'
  if (!verificationTarget(status, !verified)) return null

  const toggle = async () => {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/documents/${documentId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ verified: !verified }),
    }).catch(() => null)
    const body = (await res?.json().catch(() => null)) as { ok?: boolean; error?: string } | null
    setBusy(false)
    if (!body?.ok) {
      setError(body?.error ?? 'Could not change the status. Try again.')
      return
    }
    router.refresh()
  }

  return (
    <>
      <button
        type="button"
        className={`btn btn-block sb-btn-sm ${verified ? 'btn-ghost' : 'btn-secondary'}`}
        style={{ marginTop: 8 }}
        onClick={() => void toggle()}
        disabled={busy}
        title={
          verified
            ? 'Return this document to Extracted.'
            : 'You have read what was extracted from this document and it is right.'
        }
      >
        <i className={verified ? 'ph ph-arrow-counter-clockwise' : 'ph-bold ph-check-circle'} />
        &nbsp;{busy ? 'Saving…' : verified ? 'Mark as unverified' : 'Mark as verified'}
      </button>
      {error && (
        <p className="sb-form-error" style={{ marginTop: 6 }}>
          {error}
        </p>
      )}
    </>
  )
}
