'use client'

import Link from 'next/link'
import type { Route } from 'next'
import { useState } from 'react'
import type { FolderRow } from '@/db/queries/library'

type TreeNode = FolderRow & { children: TreeNode[]; docCount: number }

/**
 * The Library's left pane (prototype lines 210-226), rendered from our mirrored
 * folder tree rather than from Drive.
 *
 * Assembled in memory from a flat ordered list — the tree is tens to low
 * hundreds of rows, so a recursive CTE would be more machinery for less clarity.
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
    <aside className="sb-lib-tree">
      <div className="sb-kicker" style={{ padding: '12px 14px 8px' }}>
        My Drive
      </div>
      {roots.map((node) => (
        <TreeBranch key={node.driveFolderId} node={node} depth={0} activeFolderId={activeFolderId} />
      ))}

      <div className="sb-divider" style={{ marginTop: 12 }} />

      {/* Phase 2/3 filters. Shown so the shell reads as the product it is
          becoming, but visibly inert — never implying data we don't have. */}
      <div className="sb-not-real" aria-hidden="true">
        {[
          { icon: 'ph-check-circle', label: 'Verified only' },
          { icon: 'ph-warning-diamond', label: 'In violation' },
          { icon: 'ph-clock', label: 'Never checked' },
        ].map((f) => (
          <div className="sb-tree-row" key={f.label}>
            <i className={`ph ${f.icon}`} />
            <span>{f.label}</span>
            <span className="sb-tag-phase">Phase 2</span>
          </div>
        ))}
      </div>
    </aside>
  )
}

function TreeBranch({
  node,
  depth,
  activeFolderId,
}: {
  node: TreeNode
  depth: number
  activeFolderId: string
}) {
  // Ancestors of the active folder start open so a deep selection is visible.
  const [open, setOpen] = useState(() => depth === 0 || containsActive(node, activeFolderId))
  const isActive = node.driveFolderId === activeFolderId
  const hasChildren = node.children.length > 0

  return (
    <>
      <div
        className={`sb-tree-row${isActive ? ' sb-tree-row--on' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <button
          type="button"
          className="sb-tree-caret"
          onClick={() => setOpen((v) => !v)}
          disabled={!hasChildren}
          aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`}
          aria-expanded={hasChildren ? open : undefined}
        >
          {hasChildren && <i className={`ph ${open ? 'ph-caret-down' : 'ph-caret-right'}`} />}
        </button>

        <Link href={`/library/${node.driveFolderId}` as Route} className="sb-tree-link">
          <i className={`ph ${open && hasChildren ? 'ph-folder-open' : 'ph-folder'}`} />
          <span className="sb-tree-name">{node.name}</span>
          {node.docCount > 0 && <span className="sb-tree-count">{node.docCount}</span>}
        </Link>
      </div>

      {open &&
        node.children.map((child) => (
          <TreeBranch
            key={child.driveFolderId}
            node={child}
            depth={depth + 1}
            activeFolderId={activeFolderId}
          />
        ))}
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
