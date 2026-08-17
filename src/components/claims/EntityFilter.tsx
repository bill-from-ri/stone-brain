'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { Route } from 'next'
import { useMemo, useState } from 'react'
import type { EntityRow, EntityTypeOption } from '@/db/queries/claims'

/**
 * The left rail, lifted from the prototype's GRAPH sidebar (lines 622-645):
 * a find field, type counts, then entities ordered by how connected they are.
 *
 * It sits on Claims rather than only on Graph because "show me everything about
 * X" is the question this screen is actually for, and the prototype's Claims
 * view had no way to ask it — it only ever showed one document's extraction.
 */
export function EntityFilter({
  entities,
  entityTypes,
  typeCounts,
  activeEntityId,
}: {
  entities: EntityRow[]
  entityTypes: EntityTypeOption[]
  typeCounts: Record<string, number>
  activeEntityId: string | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const [find, setFind] = useState('')
  const [type, setType] = useState<string | null>(null)

  const shown = useMemo(() => {
    const needle = find.trim().toLowerCase()
    return entities.filter(
      (e) =>
        (!type || e.entityType === type) &&
        (!needle ||
          e.name.toLowerCase().includes(needle) ||
          e.nameVariants.some((v) => v.toLowerCase().includes(needle))),
    )
  }, [entities, find, type])

  const select = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('entity', id)
    else next.delete('entity')
    next.delete('claim')
    router.replace(`${pathname}?${next}` as Route, { scroll: false })
  }

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
            className={`sb-ent-item${entity.id === activeEntityId ? ' sb-ent-item--on' : ''}`}
            onClick={() => select(entity.id === activeEntityId ? null : entity.id)}
          >
            <i className="ph ph-polygon" />
            <span className="sb-ent-item-name">{entity.name}</span>
            <span className="sb-ent-item-n">{entity.claimCount}</span>
          </button>
        ))}
        {shown.length === 0 && <div className="sb-ent-note">No entities match.</div>}
      </div>
    </aside>
  )
}
