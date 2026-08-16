import Link from 'next/link'
import { getShellCounts } from '@/db/queries/library'
import { requireUser } from '@/lib/auth/guard'
import { AppHeader } from '@/components/shell/AppHeader'

export const dynamic = 'force-dynamic'

/**
 * Home, pared back from the prototype (lines 105-205).
 *
 * The prototype's four stat cards count claims, conflicts, and verified
 * documents — none of which exist until Phases 2 and 3. Rather than render
 * plausible-looking zeros, Phase 1 shows only what is true.
 */
export default async function HomePage() {
  const session = await requireUser()
  const { documentCount, folderCount } = await getShellCounts(session.user.id)

  return (
    <>
      <AppHeader />
      <div className="sb-screen" style={{ padding: '24px 20px' }}>
        <h2 style={{ fontSize: 17, fontWeight: 500, margin: '0 0 4px' }}>
          {session.rootFolderName ?? 'Your library'}
        </h2>
        <p className="sb-muted" style={{ margin: '0 0 22px' }}>
          {documentCount} {documentCount === 1 ? 'document' : 'documents'} mirrored from{' '}
          {folderCount} {folderCount === 1 ? 'folder' : 'folders'}.
        </p>

        <Link className="btn btn-primary" href="/library">
          <i className="ph ph-folders" />
          &nbsp;Open the Library
        </Link>

        <div className="sb-divider" style={{ margin: '28px 0 16px' }} />

        <p className="sb-faint" style={{ maxWidth: 560, lineHeight: 1.6 }}>
          Claims, conflicts, and the relationship graph arrive in Phases 2 and 3. Until then the
          Library mirrors your Drive folder and every document sits at <em>Unverified</em>.
        </p>
      </div>
    </>
  )
}
