import { AppHeader } from '@/components/shell/AppHeader'
import { SkelPane, SkelRail } from '@/components/shared/Skeleton'

/**
 * Shown the instant /world is clicked, while its server render is in flight.
 *
 * Without this file the route had no Suspense boundary, so Next had nothing to
 * stream: the browser held the *previous* page on screen — drawn and apparently
 * idle — for the whole render, which is what made the nav feel unresponsive.
 * It also makes `<Link>` prefetch worth something, since the prefetched payload
 * for a dynamic route is exactly this shell.
 *
 * The detail pane is absent on purpose. It only exists when something is
 * selected, and drawing a placeholder for a pane that will usually stay closed
 * would make the frame jump on arrival.
 */
export default function WorldLoading() {
  return (
    <>
      <AppHeader />
      <div className="sb-world">
        <SkelRail className="sb-ent-rail" rows={10} />
        <SkelPane rows={12} />
      </div>
    </>
  )
}
