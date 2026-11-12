import type { Route } from 'next'
import type { AttentionDocument, DocumentMix, RecentRun } from '@/db/queries/home'
import type { ProviderHealth } from '@/db/schema'

/**
 * What Home says, decided away from how it renders.
 *
 * Everything here is a pure function of rows the page has already read, so the
 * rules — which suggestion outranks which, when the list is empty, what counts
 * as activity — are testable without a database or a renderer. The rule they
 * all follow is the shell's: show only what the data backs. There is no card
 * for drafts, merges, or the Assistant, because nothing records them.
 */

/* ------------------------------------------------------------------- links */

/** The Library view that lists a document, with its detail pane open. */
export function documentHref(doc: {
  driveFileId: string
  parentDriveFolderId: string | null
}): Route {
  if (!doc.parentDriveFolderId) return '/library'
  return `/library/${doc.parentDriveFolderId}?doc=${encodeURIComponent(doc.driveFileId)}` as Route
}

/* ------------------------------------------------------------------ inputs */

export type ProviderState = { health: ProviderHealth } | null

export type HomeState = {
  mix: DocumentMix
  claimCount: number
  openConflicts: number
  attention: AttentionDocument[]
  provider: ProviderState
  sync: {
    initialCrawlDone: boolean
    lastSyncCompletedAt: string | null
    lastSyncError: string | null
  } | null
}

/**
 * Provider states in which an extraction would fail before it started. Treated
 * as "go to Settings" rather than "extract this". `unknown` is not one of them:
 * it means "not probed yet", and the first extraction is a fine probe.
 */
const PROVIDER_BROKEN: ReadonlySet<ProviderHealth> = new Set([
  'unauthorized',
  'payment_required',
  'model_rejected',
  'unreachable',
])

/* --------------------------------------------------------------- next steps */

export type NextStep = {
  key: string
  icon: string
  title: string
  detail: string
  href: Route
  tag?: { label: string; tone: 'bad' | 'neutral' | 'outline' }
  meta?: string
}

/** How many suggestions Home shows. More than this is a list, not a nudge. */
export const MAX_NEXT_STEPS = 5

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * The next useful things, most consequential first.
 *
 * Order, and why:
 *   1. Open conflicts — the graph currently asserts two things that cannot both
 *      be true; everything else is about adding to it.
 *   2. A broken or missing provider, when there is something to extract —
 *      without it no extraction suggestion below can be acted on.
 *   3. Documents changed since extraction — their claims may already be wrong.
 *   4. Documents never extracted — claims the graph does not have yet.
 *   5. Extracted documents not yet verified — a person's sign-off is pending.
 */
export function buildNextSteps(state: HomeState): NextStep[] {
  const { mix, openConflicts, attention, provider } = state
  const steps: NextStep[] = []

  if (openConflicts > 0) {
    steps.push({
      key: 'conflicts',
      icon: 'ph-warning-diamond',
      title: openConflicts === 1 ? 'One open conflict' : `${openConflicts} open conflicts`,
      detail:
        openConflicts === 1
          ? 'Two claims disagree, or a claim has lost its source. Decide which stands.'
          : 'Claims that disagree, or that have lost their source. Decide which stand.',
      href: '/conflicts',
      tag: { label: 'Needs a decision', tone: 'bad' },
    })
  }

  const extractable = mix.notExtracted + mix.changedSinceExtraction
  const providerReady = provider !== null && !PROVIDER_BROKEN.has(provider.health)

  if (extractable > 0 && !providerReady) {
    steps.push(
      provider === null
        ? {
            key: 'provider',
            icon: 'ph-plug',
            title: 'Add a model to start extracting',
            detail: `${plural(extractable, 'document')} ${extractable === 1 ? 'is' : 'are'} waiting to be read. Extraction runs on an OpenAI-compatible endpoint you configure.`,
            href: '/settings',
            tag: { label: 'Settings', tone: 'outline' },
          }
        : {
            key: 'provider',
            icon: 'ph-plug',
            title: 'Your model provider needs attention',
            detail: 'The last check against it failed, so extraction would too. Review it in Settings.',
            href: '/settings',
            tag: { label: 'Settings', tone: 'outline' },
          },
    )
  }

  const byReason = (reason: AttentionDocument['reason']) =>
    attention.filter((d) => d.reason === reason)

  // Per-document suggestions need a working provider only for the two
  // extraction reasons; verifying needs nobody's API.
  if (providerReady) {
    for (const doc of byReason('changed')) {
      steps.push(docStep(doc, {
        icon: 'ph-arrows-clockwise',
        detail: 'Edited in Drive since its claims were extracted. Re-extract to bring them up to date.',
        tag: { label: 'Changed since extraction', tone: 'neutral' },
      }))
    }
    for (const doc of byReason('not_extracted')) {
      steps.push(docStep(doc, {
        icon: 'ph-file-text',
        detail: 'Not extracted yet, so none of its claims are in the graph.',
        tag: { label: 'Not extracted', tone: 'neutral' },
      }))
    }
  }

  for (const doc of byReason('unverified')) {
    steps.push(docStep(doc, {
      icon: 'ph-list-checks',
      detail: 'Extracted and current. Read its claims against the document and mark it verified.',
      tag: { label: 'Unverified', tone: 'neutral' },
    }))
  }

  return steps.slice(0, MAX_NEXT_STEPS)
}

function docStep(
  doc: AttentionDocument,
  copy: Pick<NextStep, 'icon' | 'detail' | 'tag'>,
): NextStep {
  return {
    key: `${doc.reason}:${doc.driveFileId}`,
    title: doc.name,
    href: documentHref(doc),
    meta: doc.folderName ?? undefined,
    ...copy,
  }
}

/**
 * What to say when there is nothing to suggest — which depends on why.
 * Null means `buildNextSteps` found something and the list speaks for itself.
 */
export type NextStepsEmpty = {
  icon: string
  title: string
  detail: string
  action?: { label: string; href: Route }
}

export function emptyNextSteps(state: HomeState, steps: NextStep[]): NextStepsEmpty | null {
  if (steps.length > 0) return null

  if (state.mix.total === 0) {
    if (state.sync && !state.sync.initialCrawlDone) {
      return {
        icon: 'ph-hourglass-medium',
        title: 'The first sync is still running',
        detail: 'Documents appear in the Library as they are mirrored from your Drive folder.',
        action: { label: 'Open the Library', href: '/library' },
      }
    }
    return {
      icon: 'ph-folder-open',
      title: 'No documents yet',
      detail:
        'Your folder has no Google Docs in it. Add one in Drive, then sync from the Library.',
      action: { label: 'Open the Library', href: '/library' },
    }
  }

  return {
    icon: 'ph-check-circle',
    title: 'Nothing waiting',
    detail: 'Every document is extracted and current, and no conflicts are open.',
  }
}

/* ----------------------------------------------------------------- summary */

/** The one sentence under the heading. Says what is true, most pressing first. */
export function summarize(state: HomeState): string {
  const { mix, openConflicts } = state
  if (mix.total === 0) return 'Nothing has been mirrored from your folder yet.'

  const parts: string[] = []
  if (openConflicts > 0) parts.push(plural(openConflicts, 'open conflict'))
  if (mix.changedSinceExtraction > 0) {
    parts.push(`${plural(mix.changedSinceExtraction, 'document')} changed since extraction`)
  }
  if (mix.notExtracted > 0) parts.push(`${plural(mix.notExtracted, 'document')} not yet extracted`)

  if (parts.length === 0) {
    return mix.verified === mix.total
      ? 'Every document is extracted, current, and verified.'
      : 'Every document is extracted and current.'
  }
  return `${sentenceCase(joinList(parts))}.`
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

function sentenceCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/* ---------------------------------------------------------------- activity */

export type ActivityItem = {
  key: string
  icon: string
  tone: 'ok' | 'bad' | 'gold' | 'muted'
  /** Lead text, then the document name (if any) set in bold after it. */
  lead: string
  subject?: string
  href?: Route
  detail?: string
  at: Date
}

/**
 * Extraction runs and the last sync, as one newest-first list.
 *
 * Sync contributes at most one entry: `sync_state` keeps only the latest
 * outcome, not a history, so a second sync row would be invented.
 */
export function buildActivity(
  runs: RecentRun[],
  sync: HomeState['sync'],
  limit = 6,
): ActivityItem[] {
  const items: ActivityItem[] = runs.map((run) => {
    const href = run.documentRemoved ? undefined : documentHref(run)
    const at = run.finishedAt ?? run.startedAt

    if (run.status === 'failed') {
      return {
        key: run.id,
        icon: 'ph-warning-circle',
        tone: 'bad',
        lead: 'Extraction failed:',
        subject: run.documentName,
        href,
        detail: run.failureMessage ?? undefined,
        at,
      }
    }

    return {
      key: run.id,
      icon: 'ph-list-checks',
      tone: 'gold',
      lead: 'Extracted',
      subject: run.documentName,
      href,
      detail: runCounts(run),
      at,
    }
  })

  if (sync?.lastSyncCompletedAt) {
    items.push({
      key: 'sync',
      icon: 'ph-google-drive-logo',
      tone: sync.lastSyncError ? 'bad' : 'muted',
      lead: sync.lastSyncError ? 'Synced from Drive; a later attempt failed' : 'Synced from Drive',
      at: new Date(sync.lastSyncCompletedAt),
    })
  }

  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit)
}

function runCounts(run: RecentRun): string {
  if (run.claimsCreated === 0 && run.claimsAlreadyPresent === 0) return 'No claims found'
  const parts = [plural(run.claimsCreated, 'new claim')]
  if (run.claimsAlreadyPresent > 0) parts.push(`${run.claimsAlreadyPresent} already in the graph`)
  if (run.inversesCreated > 0) parts.push(plural(run.inversesCreated, 'inverse'))
  return parts.join(', ')
}

/* -------------------------------------------------------------------- time */

/**
 * "4 min ago", "3h ago", "2d ago" — the prototype's compact form.
 *
 * Rendered on the server against the request's clock. The absolute time goes
 * in the <time> element's dateTime, not as formatted text, because the server
 * does not know the reader's time zone and a wrong absolute time is worse than
 * none.
 */
export function timeAgo(then: Date, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(days / 365)}y ago`
}
