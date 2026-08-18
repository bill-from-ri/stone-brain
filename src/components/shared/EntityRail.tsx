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
 * The left rail of both Claims and Graph, lifted from the prototype's GRAPH
 * sidebar (lines 622-645): a find field, type counts, then entities ordered by
 * how connected they are.
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

  const shown = useMemo(() => {
    const needle = find.trim().toLowerCase()
    return entities.filter(
      (e) =>
        (!type || e.entityType === type) &&
        (!needle ||
          e.name.toLowerCase().includes(needle) ||
          (e.variants ?? []).some((v) => v.toLowerCase().includes(needle))),
    )
  }, [entities, find, type])

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

      <div className="sb-ent-kicker">Most connected</div>
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
