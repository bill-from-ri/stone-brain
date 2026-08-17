'use client'

import { useRouter } from 'next/navigation'
import type { Route } from 'next'
import { useMemo, useState } from 'react'
import type { EntityTypeOption, GraphEdge, GraphNode } from '@/db/queries/claims'

/**
 * The relationship graph.
 *
 * Layout is a deterministic radial one rather than a force simulation: the
 * focused entity sits at the centre and its neighbours ring it, ordered by how
 * connected they are. Two reasons for that over physics — it renders the same
 * way every time, which matters when you are trying to *check* a graph rather
 * than admire it; and it needs no animation loop, so the page has no runtime
 * cost after paint.
 *
 * Showing every node at once was tried and rejected: with a few hundred edges
 * it is a hairball that answers no question. One entity and its neighbourhood
 * is what the prototype drew, and it was right.
 */

const RADIUS = 168
const CENTRE = { x: 430, y: 210 }

export function GraphCanvas({
  nodes,
  edges,
  entityTypes,
  typeCounts,
}: {
  nodes: GraphNode[]
  edges: GraphEdge[]
  entityTypes: EntityTypeOption[]
  typeCounts: Record<string, number>
}) {
  const router = useRouter()

  const ranked = useMemo(() => [...nodes].sort((a, b) => b.degree - a.degree), [nodes])

  const [find, setFind] = useState('')
  const [type, setType] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(ranked[0]?.id ?? null)

  const listed = useMemo(() => {
    const needle = find.trim().toLowerCase()
    return ranked.filter(
      (n) =>
        (!type || n.entityType === type) && (!needle || n.name.toLowerCase().includes(needle)),
    )
  }, [ranked, find, type])

  const focus = nodes.find((n) => n.id === focusId) ?? null

  /** The focused node's edges, with the node at the other end resolved. */
  const spokes = useMemo(() => {
    if (!focus) return []
    const byId = new Map(nodes.map((n) => [n.id, n]))

    return edges
      .filter((e) => e.sourceId === focus.id || e.targetId === focus.id)
      .map((edge) => {
        const otherId = edge.sourceId === focus.id ? edge.targetId : edge.sourceId
        const other = byId.get(otherId)
        return other ? { edge, other, outbound: edge.sourceId === focus.id } : null
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)
  }, [focus, edges, nodes])

  const placed = useMemo(
    () =>
      spokes.map((spoke, i) => {
        // Start at the top and go clockwise, so a single neighbour sits above
        // the hub rather than at an arbitrary angle.
        const angle = (i / Math.max(spokes.length, 1)) * Math.PI * 2 - Math.PI / 2
        return {
          ...spoke,
          x: CENTRE.x + Math.cos(angle) * RADIUS,
          y: CENTRE.y + Math.sin(angle) * RADIUS * 0.82,
        }
      }),
    [spokes],
  )

  return (
    <div className="sb-graph">
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
          {listed.map((node) => (
            <button
              key={node.id}
              type="button"
              className={`sb-ent-item${node.id === focusId ? ' sb-ent-item--on' : ''}`}
              onClick={() => setFocusId(node.id)}
            >
              <i className="ph ph-polygon" />
              <span className="sb-ent-item-name">{node.name}</span>
              <span className="sb-ent-item-n">{node.degree}</span>
            </button>
          ))}
          {listed.length === 0 && <div className="sb-ent-note">No entities match.</div>}
        </div>
      </aside>

      <div className="sb-graph-main">
        <div className="sb-graph-bar">
          {focus ? (
            <div className="sb-graph-title">
              {focus.name}{' '}
              <span className="sb-faint">
                {focus.entityType} · {spokes.length}{' '}
                {spokes.length === 1 ? 'relationship' : 'relationships'}
              </span>
            </div>
          ) : (
            <div className="sb-graph-title sb-faint">No relationships to draw</div>
          )}
          <div className="sb-graph-spacer" />
          {focus && (
            <button
              type="button"
              className="btn btn-secondary sb-btn-sm"
              onClick={() => router.push(`/claims?entity=${encodeURIComponent(focus.id)}` as Route)}
            >
              View claims
            </button>
          )}
        </div>

        <div className="sb-graph-stage">
          {!focus || spokes.length === 0 ? (
            <div className="sb-empty">
              <p>Nothing to draw yet.</p>
              <p className="sb-faint">
                The graph shows relationship claims. Attributes have only one end.
              </p>
            </div>
          ) : (
            <svg viewBox="0 0 860 420" className="sb-graph-svg" role="img" aria-label="Relationship graph">
              <g stroke="rgba(232,234,238,.14)" fill="none" strokeWidth="1">
                {placed.map((s) => (
                  <path key={`line-${s.edge.id}`} d={`M${CENTRE.x} ${CENTRE.y} L ${s.x} ${s.y}`} />
                ))}
              </g>

              <g fontFamily="Inter, sans-serif" fontSize="9.5" fill="#8e959f" textAnchor="middle">
                {placed.map((s) => (
                  <text
                    key={`label-${s.edge.id}`}
                    x={(CENTRE.x + s.x) / 2}
                    y={(CENTRE.y + s.y) / 2 - 5}
                  >
                    {/* The direction matters: `ruled_by` read backwards is a lie. */}
                    {s.outbound ? s.edge.predicate : `← ${s.edge.predicate}`}
                  </text>
                ))}
              </g>

              {placed.map((s) => (
                <g
                  key={`node-${s.edge.id}`}
                  className="sb-graph-node"
                  onClick={() => setFocusId(s.other.id)}
                >
                  <circle cx={s.x} cy={s.y} r="30" fill="var(--panel)" stroke="var(--line-2)" />
                  <text
                    x={s.x}
                    y={s.y + 3}
                    textAnchor="middle"
                    fontSize="9.5"
                    fill="var(--ink)"
                    fontFamily="Inter, sans-serif"
                  >
                    {truncate(s.other.name)}
                  </text>
                </g>
              ))}

              <g>
                <circle
                  cx={CENTRE.x}
                  cy={CENTRE.y}
                  r="46"
                  fill="rgba(184,134,11,.12)"
                  stroke="#B8860B"
                  strokeWidth="1.4"
                />
                <text
                  x={CENTRE.x}
                  y={CENTRE.y + 4}
                  textAnchor="middle"
                  fontSize="11"
                  fill="var(--gold-pale)"
                  fontFamily="Inter, sans-serif"
                >
                  {truncate(focus.name, 16)}
                </text>
              </g>
            </svg>
          )}
        </div>
      </div>
    </div>
  )
}

function truncate(name: string, max = 13): string {
  return name.length <= max ? name : `${name.slice(0, max - 1)}…`
}
