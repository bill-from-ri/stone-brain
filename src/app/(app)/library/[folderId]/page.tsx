import { notFound } from 'next/navigation'
import { AppHeader } from '@/components/shell/AppHeader'
import { DetailPane } from '@/components/library/DetailPane'
import { DocumentTable, type Crumb } from '@/components/library/DocumentTable'
import { FolderTree } from '@/components/library/FolderTree'
import { SyncPoller } from '@/components/library/SyncPoller'
import {
  getDocuments,
  getFolderDocCounts,
  getFolderTree,
  getSyncStatus,
} from '@/db/queries/library'
import { requireReady } from '@/lib/auth/guard'

export const dynamic = 'force-dynamic'

/**
 * The three-pane Library, ported from the prototype (lines 208-287).
 *
 * One parallel batch and nothing after it. The detail pane's read used to be a
 * fifth query awaited here, which put a round trip between the click and the
 * table on every navigation; it now lives inside the pane, suspended.
 */
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

  /*
   * "Nevlos / History" — built by walking parents rather than splitting
   * folders.path, so every ancestor carries the id needed to link to it.
   *
   * The path starts at the chosen root and stops there. The draft opened with
   * "My Drive", but that is a place this product cannot open: everything above
   * the root is outside the grant, so naming it offers a step you cannot take.
   */
  const byId = new Map(tree.map((f) => [f.driveFolderId, f]))
  const breadcrumb: Crumb[] = []
  for (let node = activeFolder; node; node = byId.get(node.parentDriveFolderId ?? '')!) {
    breadcrumb.unshift({ name: node.name, folderId: node.driveFolderId })
    if (node.isRoot || !node.parentDriveFolderId || !byId.has(node.parentDriveFolderId)) break
  }

  return (
    <>
      <AppHeader />

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
        {/* Reads its own row, behind a Suspense boundary — see DetailPane. The
            page no longer waits on it, so an unselected Library costs nothing
            for the pane and a selected one streams it in. */}
        <DetailPane driveFileId={selectedDocId ?? null} />
      </div>
    </>
  )
}
