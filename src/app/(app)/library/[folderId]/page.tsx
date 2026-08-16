import { notFound } from 'next/navigation'
import { AppHeader } from '@/components/shell/AppHeader'
import { DetailPane } from '@/components/library/DetailPane'
import { DocumentTable } from '@/components/library/DocumentTable'
import { FolderTree } from '@/components/library/FolderTree'
import { SyncControls } from '@/components/library/SyncControls'
import { SyncPoller } from '@/components/library/SyncPoller'
import {
  getDocument,
  getDocuments,
  getFolderDocCounts,
  getFolderTree,
  getSyncStatus,
} from '@/db/queries/library'
import { requireReady } from '@/lib/auth/guard'

export const dynamic = 'force-dynamic'

/** The three-pane Library, ported from the prototype (lines 208-287). */
export default async function LibraryFolderPage({
  params,
  searchParams,
}: {
  params: Promise<{ folderId: string }>
  searchParams: Promise<{ doc?: string }>
}) {
  const session = await requireReady()
  const { folderId } = await params
  const { doc: selectedDocId } = await searchParams
  const userId = session.user.id

  const [tree, docCounts, documents, syncStatus] = await Promise.all([
    getFolderTree(userId),
    getFolderDocCounts(userId),
    getDocuments(userId, folderId),
    getSyncStatus(userId),
  ])

  // A folder id that isn't in our mirror is either a typo or something outside
  // the root. Either way it is not ours to render.
  const activeFolder = tree.find((f) => f.driveFolderId === folderId)
  if (!activeFolder) notFound()

  const selectedDoc = selectedDocId ? await getDocument(userId, selectedDocId) : null

  // "My Drive / Nevlos / History" — the draft's breadcrumb, from folders.path.
  const breadcrumb = ['My Drive', ...(activeFolder.path ?? '').split('/').filter(Boolean)]

  return (
    <>
      <AppHeader
        actions={<SyncControls initialCrawlDone={syncStatus?.initialCrawlDone ?? false} />}
      />

      <SyncPoller
        syncSeq={syncStatus?.syncSeq ?? 0}
        initialCrawlDone={syncStatus?.initialCrawlDone ?? false}
        driveConnected={session.tokenStatus === 'active'}
      />

      <div className="sb-lib">
        <FolderTree
          folders={tree}
          docCounts={Object.fromEntries(docCounts)}
          activeFolderId={folderId}
        />
        <DocumentTable
          documents={documents}
          breadcrumb={breadcrumb}
          selectedDriveFileId={selectedDocId ?? null}
          indexing={!(syncStatus?.initialCrawlDone ?? false)}
        />
        <DetailPane doc={selectedDoc} />
      </div>
    </>
  )
}
