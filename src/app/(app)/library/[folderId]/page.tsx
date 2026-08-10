import { notFound } from 'next/navigation'
import { AppHeader } from '@/components/shell/AppHeader'
import { DetailPane } from '@/components/library/DetailPane'
import { DocumentTable } from '@/components/library/DocumentTable'
import { FolderTree } from '@/components/library/FolderTree'
import { SyncPoller } from '@/components/library/SyncPoller'
import { SyncControls } from '@/components/library/SyncControls'
import {
  getDocument,
  getDocuments,
  getFolderDocCounts,
  getFolderTree,
  getRemovedCount,
  getSyncStatus,
} from '@/db/queries/library'
import { requireReady } from '@/lib/auth/guard'

export const dynamic = 'force-dynamic'

/**
 * The three-pane Library.
 *
 * Folder and document selection both live in the URL — the folder as a path
 * segment, the document as ?doc= — which is what lets DetailPane be a server
 * component and lets selection survive the router.refresh() after each sync.
 *
 * Drive IDs are used in URLs rather than our uuids: they are stable across a
 * re-crawl, and they are what you paste into a bug report.
 */
export default async function LibraryFolderPage({
  params,
  searchParams,
}: {
  params: Promise<{ folderId: string }>
  searchParams: Promise<{ doc?: string; removed?: string }>
}) {
  const session = await requireReady()
  const { folderId } = await params
  const { doc: selectedDocId, removed } = await searchParams
  const showRemoved = removed === '1'
  const userId = session.user.id

  const [tree, docCounts, documents, removedCount, syncStatus] = await Promise.all([
    getFolderTree(userId),
    getFolderDocCounts(userId),
    getDocuments(userId, folderId, { includeRemoved: showRemoved }),
    getRemovedCount(userId, folderId),
    getSyncStatus(userId),
  ])

  // A folder id that isn't in our mirror is either a typo or something outside
  // the root. Either way it is not ours to render.
  if (!tree.some((f) => f.driveFolderId === folderId)) notFound()

  const selectedDoc = selectedDocId ? await getDocument(userId, selectedDocId) : null
  const activeFolder = tree.find((f) => f.driveFolderId === folderId)
  const indexing = !(syncStatus?.initialCrawlDone ?? false)

  return (
    <>
      <AppHeader
        subtitle={activeFolder?.path ?? `Google Drive · ${session.rootFolderName ?? ''}`}
        actions={
          <SyncControls
            lastSyncCompletedAt={syncStatus?.lastSyncCompletedAt ?? null}
            initialCrawlDone={syncStatus?.initialCrawlDone ?? false}
          />
        }
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
          selectedDriveFileId={selectedDocId ?? null}
          showRemoved={showRemoved}
          removedCount={removedCount}
          indexing={indexing}
        />
        <DetailPane doc={selectedDoc} />
      </div>
    </>
  )
}
