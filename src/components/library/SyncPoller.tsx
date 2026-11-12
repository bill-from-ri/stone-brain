'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { SyncResult } from '@/lib/sync/result'

/**
 * "Live updates", Phase 1 edition (decisions §13).
 *
 * Polls POST /api/sync every 20s, but ONLY while the Library is mounted and the
 * tab is visible. The Page Visibility gate is what makes the cost bounded: a
 * forgotten tab costs nothing, which is the difference between 180 requests an
 * hour per active user and 180 an hour per user forever.
 *
 * Deltas are applied by router.refresh() rather than by patching a client cache.
 * The Library is a small, fully server-rendered projection of a Postgres table;
 * patching would mean reimplementing folder-tree assembly and count aggregation
 * in the browser — a second source of truth that can drift from the first.
 */

const IDLE_INTERVAL_MS = 20_000
/** During the first crawl, freshness is the whole experience. */
const INDEXING_INTERVAL_MS = 2_000
const MAX_BACKOFF_MS = 300_000

export function SyncPoller({
  syncSeq,
  initialCrawlDone,
  driveConnected,
}: {
  syncSeq: number
  initialCrawlDone: boolean
  driveConnected: boolean
}) {
  const router = useRouter()

  const inFlight = useRef(false)
  const backoff = useRef(0)
  const lastSeq = useRef(syncSeq)
  const stopped = useRef(false)

  useEffect(() => {
    lastSeq.current = syncSeq
  }, [syncSeq])

  useEffect(() => {
    // A dead Drive grant means polling can only produce the same answer. Stop,
    // and let the reconnect banner take over.
    if (!driveConnected) return

    let timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()
    stopped.current = false

    const interval = () => (initialCrawlDone ? IDLE_INTERVAL_MS : INDEXING_INTERVAL_MS)

    const schedule = (ms: number) => {
      clearTimeout(timer)
      timer = setTimeout(tick, ms)
    }

    const tick = async () => {
      if (stopped.current) return
      if (document.visibilityState !== 'visible') return schedule(interval())
      if (inFlight.current) return schedule(interval())

      inFlight.current = true
      try {
        const res = await fetch('/api/sync', { method: 'POST', signal: controller.signal })
        if (!res.ok) throw new Error(`sync ${res.status}`)
        const result = (await res.json()) as SyncResult

        backoff.current = 0

        if (result.tokenStatus !== 'active' && result.tokenStatus !== 'unknown') {
          // Designed state, not an error: refresh so the layout renders the
          // reconnect banner, then stop polling.
          stopped.current = true
          router.refresh()
          return
        }

        const changed = result.syncSeq !== lastSeq.current
        const didWork =
          result.documentsUpserted +
            result.documentsRemoved +
            result.foldersUpserted +
            result.foldersRemoved >
          0

        if (changed || didWork) {
          lastSeq.current = result.syncSeq
          router.refresh()
        }

        // complete:false means the crawl hit its time budget mid-flight —
        // come straight back rather than waiting out the interval.
        schedule(result.complete === false ? 250 : interval())
      } catch {
        if (controller.signal.aborted) return
        backoff.current = backoff.current
          ? Math.min(backoff.current * 2, MAX_BACKOFF_MS)
          : IDLE_INTERVAL_MS
        schedule(backoff.current)
      } finally {
        inFlight.current = false
      }
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') void tick()
    }

    void tick()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)

    return () => {
      stopped.current = true
      clearTimeout(timer)
      controller.abort()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
    }
  }, [router, initialCrawlDone, driveConnected])

  return null
}
