import type { Metadata } from 'next'
import { AppHeader } from '@/components/shell/AppHeader'
import { NextSteps } from '@/components/home/NextSteps'
import { RecentActivity } from '@/components/home/RecentActivity'
import { StatCards } from '@/components/home/StatCards'
import {
  buildActivity,
  buildNextSteps,
  emptyNextSteps,
  summarize,
  type HomeState,
} from '@/components/home/model'
import { countOpenConflicts } from '@/db/queries/conflicts'
import {
  countClaims,
  getAttentionDocuments,
  getDocumentMix,
  getRecentRuns,
} from '@/db/queries/home'
import { getSyncStatus } from '@/db/queries/library'
import { requireUser } from '@/lib/auth/guard'
import { getProviderStatus } from '@/lib/llm/provider'
import '@/styles/home.css'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Home' }

/**
 * Home, rebuilt from the prototype (the design prototype, no longer in the repo, lines
 * 104-205) on real data only.
 *
 * One parallel batch and nothing after it, the same shape as the Library page:
 * seven independent reads, none waiting on another. What to suggest and what
 * counts as activity is decided in components/home/model.ts, as pure functions
 * of these rows, so the rules are tested without a database.
 *
 * The prototype's summary line ("Six contradictions surfaced since your last
 * check…") was an editorial judgement nobody computes; the sentence here is
 * assembled from the same counts the cards show.
 */
export default async function HomePage() {
  const session = await requireUser()
  const userId = session.user.id

  const [mix, claimCount, openConflicts, attention, runs, sync, provider] = await Promise.all([
    getDocumentMix(userId),
    countClaims(userId),
    countOpenConflicts(userId),
    getAttentionDocuments(userId),
    getRecentRuns(userId),
    getSyncStatus(userId),
    getProviderStatus(userId),
  ])

  const state: HomeState = {
    mix,
    claimCount,
    openConflicts,
    attention,
    provider: provider ? { health: provider.health } : null,
    sync,
  }
  const steps = buildNextSteps(state)
  const now = new Date()

  return (
    <>
      <AppHeader />
      <div className="sb-screen">
        <div className="sb-home">
          <div>
            <h1 className="sb-home-title">{session.rootFolderName ?? 'Your library'}, at a glance</h1>
            <p className="sb-home-summary">{summarize(state)}</p>
          </div>

          <StatCards
            mix={mix}
            claimCount={claimCount}
            openConflicts={openConflicts}
            sync={sync}
            now={now}
          />

          <div className="sb-home-cols">
            <NextSteps steps={steps} empty={emptyNextSteps(state, steps)} />
            <RecentActivity items={buildActivity(runs, sync)} now={now} />
          </div>
        </div>
      </div>
    </>
  )
}
