'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type Folder = { id: string; name: string }

type NodeState = {
  children: Folder[]
  nextPageToken?: string
  expanded: boolean
  loading: boolean
  error?: string
}

const ROOT = 'root'
const MY_DRIVE: Folder = { id: ROOT, name: 'My Drive' }

/**
 * The in-app root-folder picker (decisions §2 dropped the Google Picker).
 *
 * Children are lazy-loaded on expand and cached by folder id, so re-expanding a
 * branch costs nothing. Search is a flat fallback for deep trees.
 */
export function FolderBrowser() {
  const router = useRouter()
  const [nodes, setNodes] = useState<Record<string, NodeState>>({})
  const [selected, setSelected] = useState<Folder | null>(null)
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<Folder[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (id: string, append = false) => {
    setNodes((prev) => ({
      ...prev,
      [id]: {
        children: prev[id]?.children ?? [],
        expanded: true,
        loading: true,
        ...(prev[id]?.nextPageToken ? { nextPageToken: prev[id]!.nextPageToken } : {}),
      },
    }))

    try {
      const token = append ? nodesRef.current[id]?.nextPageToken : undefined
      const params = new URLSearchParams({ parent: id })
      if (token) params.set('pageToken', token)

      const res = await fetch(`/api/drive/browse?${params}`)
      if (!res.ok) throw new Error(await describe(res))
      const data = (await res.json()) as { folders: Folder[]; nextPageToken?: string }

      setNodes((prev) => ({
        ...prev,
        [id]: {
          children: append ? [...(prev[id]?.children ?? []), ...data.folders] : data.folders,
          expanded: true,
          loading: false,
          ...(data.nextPageToken ? { nextPageToken: data.nextPageToken } : {}),
        },
      }))
    } catch (err) {
      setNodes((prev) => ({
        ...prev,
        [id]: {
          children: prev[id]?.children ?? [],
          expanded: true,
          loading: false,
          error: err instanceof Error ? err.message : 'Could not load folders',
        },
      }))
    }
  }, [])

  // Keep a ref alongside state so `load` can read pagination tokens without
  // taking `nodes` as a dependency (which would recreate it on every keystroke).
  const nodesRef = useRef(nodes)
  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

  useEffect(() => {
    void load(ROOT)
  }, [load])

  const toggle = (id: string) => {
    const node = nodes[id]
    if (!node) return void load(id)
    if (node.expanded) {
      setNodes((prev) => ({ ...prev, [id]: { ...prev[id]!, expanded: false } }))
    } else {
      setNodes((prev) => ({ ...prev, [id]: { ...prev[id]!, expanded: true } }))
    }
  }

  // Debounced search, so typing doesn't fire a Drive query per keystroke.
  useEffect(() => {
    const term = search.trim()
    if (term.length < 2) {
      setResults(null)
      return
    }
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/drive/browse?q=${encodeURIComponent(term)}`)
        if (!res.ok) throw new Error(await describe(res))
        const data = (await res.json()) as { folders: Folder[] }
        setResults(data.folders)
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [search])

  const confirm = async () => {
    if (!selected) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/setup/root', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ folderId: selected.id }),
      })
      if (!res.ok) throw new Error(await describe(res))
      // The gate in (auth)/layout.tsx will now send them onward.
      router.replace('/library')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that folder')
      setSubmitting(false)
    }
  }

  const renderTree = (folder: Folder, depth: number) => {
    const node = nodes[folder.id]
    const isSelected = selected?.id === folder.id
    const expanded = node?.expanded ?? false

    return (
      <div key={folder.id}>
        <div
          className={`sb-pick-row${isSelected ? ' sb-pick-row--on' : ''}`}
          style={{ paddingLeft: 8 + depth * 16 }}
        >
          <button
            type="button"
            className="sb-pick-caret"
            onClick={() => toggle(folder.id)}
            aria-label={expanded ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
            aria-expanded={expanded}
          >
            <i className={`ph ${expanded ? 'ph-caret-down' : 'ph-caret-right'}`} />
          </button>
          <button type="button" className="sb-pick-name" onClick={() => setSelected(folder)}>
            <i className={`ph ${expanded ? 'ph-folder-open' : 'ph-folder'}`} />
            <span>{folder.name}</span>
          </button>
        </div>

        {expanded && (
          <>
            {node?.loading && <div className="sb-pick-note" style={{ paddingLeft: 30 + depth * 16 }}>Loading…</div>}
            {node?.error && (
              <div className="sb-pick-note sb-pick-note--bad" style={{ paddingLeft: 30 + depth * 16 }}>
                {node.error}
              </div>
            )}
            {!node?.loading && node?.children.length === 0 && !node.error && (
              <div className="sb-pick-note" style={{ paddingLeft: 30 + depth * 16 }}>
                No subfolders
              </div>
            )}
            {node?.children.map((child) => renderTree(child, depth + 1))}
            {node?.nextPageToken && (
              <button
                type="button"
                className="sb-pick-note sb-pick-more"
                style={{ paddingLeft: 30 + depth * 16 }}
                onClick={() => void load(folder.id, true)}
              >
                Load more…
              </button>
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="sb-search" style={{ width: '100%', marginBottom: 12 }}>
        <i className="ph ph-magnifying-glass" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search folders by name"
          aria-label="Search folders by name"
        />
      </div>

      <div className="sb-pick-tree">
        {results !== null ? (
          <>
            {searching && <div className="sb-pick-note">Searching…</div>}
            {!searching && results.length === 0 && (
              <div className="sb-pick-note">No folders match “{search.trim()}”.</div>
            )}
            {results.map((f) => (
              <div
                key={f.id}
                className={`sb-pick-row${selected?.id === f.id ? ' sb-pick-row--on' : ''}`}
              >
                <button type="button" className="sb-pick-name" onClick={() => setSelected(f)}>
                  <i className="ph ph-folder" />
                  <span>{f.name}</span>
                </button>
              </div>
            ))}
          </>
        ) : (
          renderTree(MY_DRIVE, 0)
        )}
      </div>

      {selected?.id === ROOT && (
        <p className="sb-footnote" role="note">
          Selecting all of My Drive means every document in your Drive becomes part of the library.
          Stone Brain will still only read what it indexes, but the “one folder” framing no longer
          applies — pick a specific folder if you want a boundary.
        </p>
      )}

      {error && (
        <div className="sb-banner" role="alert" style={{ borderRadius: 8, margin: '14px 0' }}>
          <i className="ph-bold ph-warning-circle" />
          <div className="sb-banner-text">{error}</div>
        </div>
      )}

      <div className="sb-pick-actions">
        <button
          className="btn btn-primary"
          type="button"
          disabled={!selected || submitting}
          onClick={() => void confirm()}
        >
          {submitting ? 'Setting up…' : selected ? `Use “${selected.name}”` : 'Select a folder'}
        </button>
      </div>
    </>
  )
}

async function describe(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string }
  switch (body.error) {
    case 'drive_auth':
      return 'Your Drive connection expired. Reconnect and try again.'
    case 'folder_not_found':
      return 'That folder no longer exists in Drive.'
    case 'not_a_folder':
      return 'That item is not a folder.'
    case 'folder_trashed':
      return 'That folder is in the trash.'
    case 'drive_unavailable':
      return 'Drive is not responding. Try again in a moment.'
    default:
      return `Something went wrong (${res.status}).`
  }
}
