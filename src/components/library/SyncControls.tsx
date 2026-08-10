'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SyncResult } from '@/lib/sync/result'

/**
 * The header's "Sync Drive" button and freshness readout.
 *
 * Kept permanently rather than hidden once polling works: users trust a button
 * they can press when they know they just changed something, and it is the
 * escape hatch when the 20s cadence isn't fast enough (decisions §4).
 */
export function SyncControls({
  lastSyncCompletedAt,
  initialCrawlDone,
}: {
  lastSyncCompletedAt: string | null
  initialCrawlDone: boolean
}) {
  const router = useRouter()
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState(false)
  const [ago, setAgo] = useState<string | null>(null)

  // Rendered null on the server and filled in on the client: a relative time
  // computed during SSR is wrong by the time it hydrates.
  useEffect(() => {
    if (!lastSyncCompletedAt) return setAgo(null)
    const update = () => setAgo(relative(new Date(lastSyncCompletedAt)))
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [lastSyncCompletedAt])

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
        {syncing
          ? 'Syncing…'
          : error
            ? 'Sync failed'
            : !initialCrawlDone
              ? 'Indexing…'
              : ago
                ? `Synced ${ago}`
                : ''}
      </span>
      <button className="btn" type="button" onClick={() => void syncNow()} disabled={syncing}>
        <i className={`ph ${syncing ? 'ph-circle-notch' : 'ph-arrows-clockwise'}`} />
        &nbsp;Sync Drive
      </button>
    </>
  )
}

function relative(then: Date): string {
  const seconds = Math.max(0, Math.round((Date.now() - then.getTime()) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}
