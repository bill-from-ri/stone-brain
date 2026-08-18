'use client'

import Link from 'next/link'
import type { Route } from 'next'
import { useState } from 'react'
import type { FolderRow } from '@/db/queries/library'

type TreeNode = FolderRow & { children: TreeNode[]; docCount: number }

/**
 * The Library's left pane, ported from the prototype (lines 210-226).
 *
 * Structure follows the draft exactly: an uppercase "My Drive" kicker, the root
 * folder as an open caret row, children in an indented container, then a faded
 * divider and the saved-filter list.
 */
export function FolderTree({
  folders,
  docCounts,
  activeFolderId,
}: {
  folders: FolderRow[]
  docCounts: Record<string, number>
  activeFolderId: string
}) {
  const roots = buildTree(folders, docCounts)

  return (
    <div className="sb-lib-tree">
      {/* The draft's kicker read "My Drive", with the root folder beneath it as
          a child. It says "Folders" now, for the same reason the breadcrumb
          starts at the root: everything above the chosen folder is outside the
          grant, and naming it implies a place you can navigate to. */}
      <div className="sb-tree-kicker">Folders</div>

      {roots.map((node) => (
        <Branch key={node.driveFolderId} node={node} activeFolderId={activeFolderId} />
      ))}

      <div className="sb-tree-divider" />

      {/* Phase 2/3 filters. Present because the draft has them, but visibly
          inert — the shell should read as the product it is becoming without
          ever implying data we don't have. */}
      <div className="sb-tree-filters">
        <div className="sb-tree-filter">
          <i className="ph ph-check-circle" style={{ color: 'var(--ok)' }} />
          Verified only
          <span className="sb-tree-phase">Phase 2</span>
        </div>
        <div className="sb-tree-filter">
          <i className="ph ph-warning-diamond" style={{ color: 'var(--bad)' }} />
          In violation
          <span className="sb-tree-phase">Phase 3</span>
        </div>
        <div className="sb-tree-filter">
          <i className="ph ph-clock-counter-clockwise" style={{ color: 'var(--faint)' }} />
          Never checked
          <span className="sb-tree-phase">Phase 2</span>
        </div>
      </div>
    </div>
  )
}

function Branch({ node, activeFolderId }: { node: TreeNode; activeFolderId: string }) {
  const [open, setOpen] = useState(() => containsActive(node, activeFolderId))
  const hasChildren = node.children.length > 0
  const isActive = node.driveFolderId === activeFolderId

  return (
    <>
      <div className={`sb-tree-row${isActive ? ' sb-tree-row--on' : ''}`}>
        {hasChildren ? (
          <button
            type="button"
            className="sb-tree-caret"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`}
            aria-expanded={open}
          >
            <i className={`ph-bold ${open ? 'ph-caret-down' : 'ph-caret-right'}`} />
          </button>
        ) : (
          <span className="sb-tree-caret" />
        )}

        <Link href={`/library/${node.driveFolderId}` as Route} className="sb-tree-link">
          <i
            className={`ph ${open && hasChildren ? 'ph-folder-open' : 'ph-folder'}`}
            style={{ color: isActive || open ? 'var(--gold-lite)' : 'var(--faint)' }}
          />
          <span className="sb-tree-name">{node.name}</span>
          {node.docCount > 0 && <span className="sb-tree-count">{node.docCount}</span>}
        </Link>
      </div>

      {open && hasChildren && (
        <div className="sb-tree-children">
          {node.children.map((child) => (
            <Branch key={child.driveFolderId} node={child} activeFolderId={activeFolderId} />
          ))}
        </div>
      )}
    </>
  )
}

function containsActive(node: TreeNode, activeId: string): boolean {
  if (node.driveFolderId === activeId) return true
  return node.children.some((c) => containsActive(c, activeId))
}

function buildTree(rows: FolderRow[], docCounts: Record<string, number>): TreeNode[] {
  const nodes = new Map<string, TreeNode>()
  for (const row of rows) {
    nodes.set(row.driveFolderId, {
      ...row,
      children: [],
      docCount: docCounts[row.driveFolderId] ?? 0,
    })
  }

  const roots: TreeNode[] = []
  for (const node of nodes.values()) {
    const parent = node.parentDriveFolderId ? nodes.get(node.parentDriveFolderId) : undefined
    if (node.isRoot || !parent) roots.push(node)
    else parent.children.push(node)
  }

  const sort = (list: TreeNode[]) => {
    list.sort((a, b) => a.name.localeCompare(b.name))
    for (const n of list) sort(n.children)
  }
  sort(roots)

  return roots
}
