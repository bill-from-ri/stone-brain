'use client'

import { useRouter } from 'next/navigation'
import type { Route } from 'next'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { SearchResponse } from '@/app/api/search/route'

/**
 * The header's search field (prototype line 94-97), as a typeahead over
 * documents and entities.
 *
 * It lives on every screen but Settings, so it cannot filter "the current view"
 * — most screens have no documents on them. Instead it searches everything and
 * offers the matches; navigation happens on a deliberate pick, never as a side
 * effect of typing, so a half-typed word never moves you anywhere.
 *
 * Documents and entities are visually distinct by icon and by subtitle, because
 * they go to different places: a document opens in the Library, an entity opens
 * its claims. A row that looked the same but behaved differently would be worse
 * than two lists.
 *
 * Entity matching is alias-aware — "Nethros" finds Enua — through the same
 * normalisation the entity matcher uses. When the hit came from an alias the
 * row says so, since otherwise the result looks like a mistake.
 */

type DocHit = SearchResponse['documents'][number]
type EntityHit = SearchResponse['entities'][number]
type Hit = { kind: 'document'; hit: DocHit } | { kind: 'entity'; hit: EntityHit }

const NO_RESULTS: SearchResponse = { documents: [], entities: [] }

export function GlobalSearch() {
  const router = useRouter()
  const listId = useId()

  const [value, setValue] = useState('')
  /*
   * The last answer, labelled with the query it answers. Results and "still
   * searching" are both derived from it against the current query rather than
   * kept as their own state, so clearing the field or typing past an answer
   * never needs a state write of its own — the old answer simply stops
   * matching.
   */
  const [answer, setAnswer] = useState<{ query: string; results: SearchResponse } | null>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const rootRef = useRef<HTMLDivElement>(null)
  /** Guards against a slow response for "ab" overwriting a fast one for "abcd". */
  const latest = useRef(0)

  const query = value.trim()
  const results = answer?.query === query ? answer.results : NO_RESULTS
  const loading = query !== '' && answer?.query !== query

  /** Entities first: a named thing is a more specific answer than a file. */
  const hits = useMemo<Hit[]>(
    () => [
      ...results.entities.map((hit) => ({ kind: 'entity' as const, hit })),
      ...results.documents.map((hit) => ({ kind: 'document' as const, hit })),
    ],
    [results],
  )

  useEffect(() => {
    if (!query) return

    const seq = ++latest.current
    const controller = new AbortController()

    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((res) =>
          res.ok
            ? (res.json() as Promise<SearchResponse>)
            : { documents: [], entities: [] satisfies SearchResponse['entities'] },
        )
        .then((data) => {
          if (seq !== latest.current) return
          setAnswer({ query, results: data })
          setActive(0)
        })
        .catch(() => {
          if (seq !== latest.current || controller.signal.aborted) return
          setAnswer({ query, results: NO_RESULTS })
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

  const go = (entry: Hit) => {
    setOpen(false)
    setValue('')

    if (entry.kind === 'entity') {
      // /world directly, not the /claims alias: that alias is a dynamic page
      // whose only job is to redirect here, so going through it would make
      // every entity hit pay for two server renders before anything drew.
      router.push(`/world?entity=${encodeURIComponent(entry.hit.id)}` as Route)
      return
    }
    if (!entry.hit.folderId) return
    router.push(
      `/library/${entry.hit.folderId}?doc=${encodeURIComponent(entry.hit.driveFileId)}` as Route,
    )
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
      const entry = hits[active]
      if (entry) go(entry)
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
          placeholder="Search documents and entities"
          aria-label="Search documents and entities"
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
            <li className="sb-search-note">
              {loading ? 'Searching…' : 'No documents or entities match.'}
            </li>
          ) : (
            hits.map((entry, i) => {
              const key = entry.kind === 'entity' ? entry.hit.id : entry.hit.driveFileId
              return (
                <li key={`${entry.kind}-${key}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    className={`sb-search-opt${i === active ? ' sb-search-opt--on' : ''}`}
                    // mousedown, not click: the input's blur would otherwise close
                    // the list out from under the pointer.
                    onMouseDown={(e) => {
                      e.preventDefault()
                      go(entry)
                    }}
                    onMouseEnter={() => setActive(i)}
                  >
                    {entry.kind === 'entity' ? (
                      <i className="ph ph-polygon sb-search-opt-icon--entity" />
                    ) : (
                      <i className="ph ph-file-doc" />
                    )}
                    <span className="sb-search-opt-text">
                      <span className="sb-search-opt-name">{entry.hit.name}</span>
                      <span className="sb-search-opt-path">
                        {entry.kind === 'entity'
                          ? entry.hit.matchedVariant
                            ? `${entry.hit.typeLabel} · also “${entry.hit.matchedVariant}”`
                            : entry.hit.typeLabel
                          : entry.hit.path || 'Library root'}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })
          )}
        </ul>
      )}
    </div>
  )
}
