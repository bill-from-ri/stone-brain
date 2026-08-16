'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SyncResult } from '@/lib/sync/result'

/**
 * The header's "Sync Drive" button and freshness readout.
 *
 * Kept permanently rather than hidden once polling works: users trust a button
 * they can press when they know they just changed something, and it is the
 * escape hatch when the 20s cadence isn't fast enough (decisions §4).
 *
 * The readout deliberately shows only transient states. A "Synced 14s ago" line
 * has to re-render every second to stay honest, and a counter ticking in the
 * corner of the screen costs more attention than the fact is worth.
 */
export function SyncControls({ initialCrawlDone }: { initialCrawlDone: boolean }) {
  const router = useRouter()
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState(false)

  const syncNow = async () => {
    setSyncing(true)
    setError(false)
    try {
      // manual=1 buys the long budget — a hand-triggered sync can afford to
      // finish rather than yielding at 45s like the poller does.
      const res = await fetch('/api/sync?manual=1', { method: 'POST' })
      if (!res.ok) throw new Error(String(res.status))
      const result = (await res.json()) as SyncResult
      if (result.error && !result.running) setError(true)
      router.refresh()
    } catch {
      setError(true)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <>
      <span className="sb-sync-state">
        {syncing ? 'Syncing…' : error ? 'Sync failed' : !initialCrawlDone ? 'Indexing…' : ''}
      </span>
      <button className="btn btn-secondary" type="button" onClick={() => void syncNow()} disabled={syncing}>
        <i className={`ph ${syncing ? 'ph-circle-notch' : 'ph-arrows-clockwise'}`} />
        &nbsp;Sync Drive
      </button>
    </>
  )
}
