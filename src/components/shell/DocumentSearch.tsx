'use client'

import { useRouter } from 'next/navigation'
import type { Route } from 'next'
import { useEffect, useId, useRef, useState } from 'react'
import type { SearchResponse } from '@/app/api/search/route'

type Hit = SearchResponse['hits'][number]

/**
 * The header's search field (prototype line 94-97), as a typeahead.
 *
 * It lives on every screen but Settings, so it cannot filter "the current view"
 * — most screens have no documents on them. Instead it searches the whole
 * mirror and offers the matches; navigation happens on a deliberate pick, never
 * as a side effect of typing, so a half-typed word never moves you anywhere.
 *
 * The prototype's placeholder promises claims and entities; in Phase 1 there are
 * none, so it searches document names and says so.
 */
export function DocumentSearch() {
  const router = useRouter()
  const listId = useId()

  const [value, setValue] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)

  const rootRef = useRef<HTMLDivElement>(null)
  /** Guards against a slow response for "ab" overwriting a fast one for "abcd". */
  const latest = useRef(0)

  const query = value.trim()

  useEffect(() => {
    if (!query) {
      setHits([])
      setLoading(false)
      return
    }

    setLoading(true)
    const seq = ++latest.current
    const controller = new AbortController()

    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((res) => (res.ok ? (res.json() as Promise<SearchResponse>) : { hits: [] }))
        .then((data) => {
          if (seq !== latest.current) return
          setHits(data.hits)
          setActive(0)
          setLoading(false)
        })
        .catch(() => {
          if (seq !== latest.current || controller.signal.aborted) return
          setHits([])
          setLoading(false)
        })
    }, 180)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  // Clicking anywhere else dismisses the list. Focus alone is not enough —
  // clicking a result would blur the input before the click landed.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const go = (hit: Hit) => {
    setOpen(false)
    setValue('')
    if (!hit.folderId) return
    router.push(`/library/${hit.folderId}?doc=${encodeURIComponent(hit.driveFileId)}` as Route)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!open || hits.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % hits.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + hits.length) % hits.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = hits[active]
      if (hit) go(hit)
    }
  }

  const showList = open && query.length > 0

  return (
    <div className="sb-search-wrap" ref={rootRef}>
      <label className="sb-search">
        <i className="ph ph-magnifying-glass" />
        <input
          className="input"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search documents"
          aria-label="Search documents by name"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
        />
      </label>

      {showList && (
        <ul className="sb-search-menu" id={listId} role="listbox">
          {hits.length === 0 ? (
            <li className="sb-search-note">{loading ? 'Searching…' : 'No documents match.'}</li>
          ) : (
            hits.map((hit, i) => (
              <li key={hit.driveFileId}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  className={`sb-search-opt${i === active ? ' sb-search-opt--on' : ''}`}
                  // mousedown, not click: the input's blur would otherwise close
                  // the list out from under the pointer.
                  onMouseDown={(e) => {
                    e.preventDefault()
                    go(hit)
                  }}
                  onMouseEnter={() => setActive(i)}
                >
                  <i className="ph ph-file-doc" />
                  <span className="sb-search-opt-text">
                    <span className="sb-search-opt-name">{hit.name}</span>
                    <span className="sb-search-opt-path">{hit.path || 'Library root'}</span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
