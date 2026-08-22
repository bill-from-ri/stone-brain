'use client'

import { useMemo, useState } from 'react'
import type { EntityTypeOption } from '@/db/queries/claims'
import { entityIcon } from './entity-icon'

export type RailEntity = {
  id: string
  name: string
  entityType: string
  /** Claims on Claims, degree on Graph — the same "how much is here" number. */
  count: number
  /** Alternate spellings, when the screen has them to search. */
  variants?: string[]
}

/**
 * How the rail's entities are ordered. The prototype only ever offered the
 * first of these, which answers "what is this world mostly about?" and nothing
 * else — a rail of any size is also something you scan alphabetically, and the
 * thin end of the list is where the entities nobody has said much about yet
 * are, which is its own useful question.
 *
 * Grouping by type is the one ordering that is not a single key: within a type
 * it stays on most-connected, because that is the order you want once the
 * question has narrowed to "which organisation?".
 */
export type RailSort = 'connected-desc' | 'connected-asc' | 'name-asc' | 'name-desc' | 'type'

const SORT_LABELS: { value: RailSort; label: string }[] = [
  { value: 'connected-desc', label: 'Most connected' },
  { value: 'connected-asc', label: 'Least connected' },
  { value: 'name-asc', label: 'A–Z' },
  { value: 'name-desc', label: 'Z–A' },
  { value: 'type', label: 'By type' },
]

/**
 * The left rail of both Claims and Graph, lifted from the prototype's GRAPH
 * sidebar (lines 622-645): a find field, type counts, then entities in a
 * chosen order.
 *
 * Claims and Graph each had their own copy of this markup. They are the same
 * list asking the same question — "which entity are we talking about?" — and
 * differ only in where the answer goes, so the rail is presentational and the
 * caller owns the selection.
 */
export function EntityRail({
  entities,
  entityTypes,
  typeCounts,
  activeId,
  onSelect,
}: {
  entities: RailEntity[]
  entityTypes: EntityTypeOption[]
  typeCounts: Record<string, number>
  activeId: string | null
  /** Called with the entity, or null when the active one is clicked again. */
  onSelect: (id: string | null) => void
}) {
  const [find, setFind] = useState('')
  const [type, setType] = useState<string | null>(null)
  const [sort, setSort] = useState<RailSort>('connected-desc')

  const typeLabels = useMemo(
    () => new Map(entityTypes.map((t) => [t.name, t.label])),
    [entityTypes],
  )

  const shown = useMemo(() => {
    const needle = find.trim().toLowerCase()
    const matched = entities.filter(
      (e) =>
        (!type || e.entityType === type) &&
        (!needle ||
          e.name.toLowerCase().includes(needle) ||
          (e.variants ?? []).some((v) => v.toLowerCase().includes(needle))),
    )

    /*
     * Sorted here rather than in the query. The rail is filtered on the client
     * already, so re-ordering it is the same kind of work — and asking the
     * server to re-sort would put a round trip in front of a control that has
     * nothing new to fetch.
     *
     * Every ordering falls back to the name, so entities tied on a count keep a
     * stable, readable order instead of the database's.
     */
    const byName = (a: RailEntity, b: RailEntity) => a.name.localeCompare(b.name)

    return matched.sort((a, b) => {
      switch (sort) {
        case 'connected-desc':
          return b.count - a.count || byName(a, b)
        case 'connected-asc':
          return a.count - b.count || byName(a, b)
        case 'name-asc':
          return byName(a, b)
        case 'name-desc':
          return byName(b, a)
        case 'type': {
          const label = (e: RailEntity) => typeLabels.get(e.entityType) ?? e.entityType
          return label(a).localeCompare(label(b)) || b.count - a.count || byName(a, b)
        }
      }
    })
  }, [entities, find, type, sort, typeLabels])

  return (
    <aside className="sb-ent-rail">
      <label className="sb-search sb-ent-find">
        <i className="ph ph-magnifying-glass" />
        <input
          className="input"
          value={find}
          onChange={(e) => setFind(e.target.value)}
          placeholder="Find an entity"
          aria-label="Find an entity"
        />
      </label>

      <div className="sb-ent-kicker">Entity types</div>
      <div className="sb-ent-tags">
        {entityTypes
          .filter((t) => (typeCounts[t.name] ?? 0) > 0)
          .map((t) => (
            <button
              key={t.name}
              type="button"
              className={`tag ${type === t.name ? 'sb-tag-on' : 'tag-neutral'}`}
              onClick={() => setType(type === t.name ? null : t.name)}
            >
              {t.label} {typeCounts[t.name]}
            </button>
          ))}
      </div>

      {/* No heading beside it: the chosen ordering names the list as well as
          "Entities" would, and the two together left the chevron crowding the
          label. The select sits where the kicker used to. */}
      <div className="sb-ent-kicker sb-ent-sort-row">
        <select
          className="sb-ent-sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as RailSort)}
          aria-label="Order entities by"
        >
          {SORT_LABELS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="sb-ent-list">
        {shown.map((entity) => (
          <button
            key={entity.id}
            type="button"
            className={`sb-ent-item${entity.id === activeId ? ' sb-ent-item--on' : ''}`}
            onClick={() => onSelect(entity.id === activeId ? null : entity.id)}
          >
            <i className={entityIcon(entity.entityType)} />
            <span className="sb-ent-item-name">{entity.name}</span>
            <span className="sb-ent-item-n">{entity.count}</span>
          </button>
        ))}
        {shown.length === 0 && <div className="sb-ent-note">No entities match.</div>}
      </div>
    </aside>
  )
}
