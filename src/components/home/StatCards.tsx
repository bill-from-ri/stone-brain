import type { DocumentMix } from '@/db/queries/home'
import { timeAgo, type HomeState } from './model'

type Props = {
  mix: DocumentMix
  claimCount: number
  openConflicts: number
  sync: HomeState['sync']
  now: Date
}

const fmt = new Intl.NumberFormat('en-GB')

/**
 * The design prototype's four stat cards (the prototype is no longer in the repo),
 * each now backed by a query. Two of the prototype's sub-lines are gone
 * because nothing records them: "+38 this week" needs claim history by week,
 * and "2 flagged high impact" needs an impact score no part of the product
 * computes. "Last full check" became "Last sync", which is the event that
 * actually has a timestamp.
 */
export function StatCards({ mix, claimCount, openConflicts, sync, now }: Props) {
  return (
    <ul className="sb-home-stats" aria-label="Your library in numbers">
      <Stat label="Documents" value={fmt.format(mix.total)}>
        {mix.verified > 0 ? (
          <span className="sb-home-stat-ok">
            <i className="ph-bold ph-check-circle" aria-hidden="true" />
            {fmt.format(mix.verified)} verified
          </span>
        ) : (
          'None verified yet'
        )}
      </Stat>

      <Stat label="Claims in graph" value={fmt.format(claimCount)}>
        {mix.extracted > 0
          ? `From ${fmt.format(mix.extracted)} extracted ${mix.extracted === 1 ? 'document' : 'documents'}`
          : 'Nothing extracted yet'}
      </Stat>

      <Stat label="Open conflicts" value={fmt.format(openConflicts)} alert={openConflicts > 0}>
        {openConflicts > 0 ? 'Waiting for a decision' : 'None open'}
      </Stat>

      <Stat
        label="Last sync"
        value={
          sync?.lastSyncCompletedAt ? (
            <time dateTime={sync.lastSyncCompletedAt}>
              {timeAgo(new Date(sync.lastSyncCompletedAt), now)}
            </time>
          ) : (
            '—'
          )
        }
      >
        {syncNote(sync)}
      </Stat>
    </ul>
  )
}

function syncNote(sync: HomeState['sync']) {
  if (sync?.lastSyncError) {
    return <span className="sb-home-stat-bad">The latest attempt failed</span>
  }
  if (!sync?.initialCrawlDone) return 'First crawl in progress'
  if (!sync.lastSyncCompletedAt) return 'Not synced yet'
  return 'Read-only, from Drive'
}

function Stat({
  label,
  value,
  alert = false,
  children,
}: {
  label: string
  value: React.ReactNode
  alert?: boolean
  children: React.ReactNode
}) {
  return (
    <li className="sb-home-stat" data-alert={alert || undefined}>
      <div className="sb-home-stat-label">{label}</div>
      <div className="sb-home-stat-value">{value}</div>
      <div className="sb-home-stat-note">{children}</div>
    </li>
  )
}
