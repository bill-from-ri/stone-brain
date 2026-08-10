import { requireReady } from '@/lib/auth/guard'
import { AppHeader } from '@/components/shell/AppHeader'

export const dynamic = 'force-dynamic'

/** The three-pane Library lands in M6. */
export default async function LibraryPage() {
  const session = await requireReady()

  return (
    <>
      <AppHeader subtitle={`Google Drive · ${session.rootFolderName ?? ''}`} />
      <div className="sb-screen" style={{ padding: '24px 20px' }}>
        <p className="sb-muted">Library UI under construction.</p>
      </div>
    </>
  )
}
