import { AppHeader } from '@/components/shell/AppHeader'
import { SkelPane, SkelRail } from '@/components/shared/Skeleton'

/** The Library's instant shell — see the note in ../../world/loading.tsx. */
export default function LibraryLoading() {
  return (
    <>
      <AppHeader />
      <div className="sb-lib">
        <SkelRail className="sb-lib-tree" rows={8} />
        <SkelPane rows={11} />
      </div>
    </>
  )
}
