'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Graph } from '@/db/queries/claims'
import { EmptyState } from '@/components/shared/RecordTable'
import { predicateText } from '@/components/shared/predicate'
import { useHydrated } from '@/components/shared/useHydrated'
import {
  ALPHA_MIN,
  ATTRIBUTE_LINK_DISTANCE,
  ENTITY_LINK_DISTANCE,
  bounds,
  createSim,
  nodeRadius,
  pin,
  reheat,
  release,
  settle,
  step,
  type Sim,
} from './force'

/**
 * The world as a picture: every entity, the relationships between them, and the
 * attributes hanging off them as diamond leaves.
 *
 * Selecting an entity never redraws the graph. It lights that entity and its
 * direct neighbours and dims everything else, so the shape of the world stays
 * put underneath your reading of one corner of it — the thing a filter-and-
 * redraw graph takes away on every click.
 *
 * Layout lives in ./force.ts. This file owns the frame loop, the viewport, and
 * the pointer, and nothing else.
 */

type Box = { x: number; y: number; width: number; height: number }

const MIN_SPAN = 120
const MAX_SPAN = 12_000
/** Above this many nodes, only what you are looking at keeps its label. */
const LABEL_EVERYTHING_BELOW = 70

type Props = {
  graph: Graph
  activeEntityId: string | null
  onSelect: (entityId: string | null) => void
}

/**
 * Laid out in the browser, never on the server.
 *
 * The simulation is deterministic given the same arithmetic, but `Math.cos` and
 * `Math.sin` are not bit-identical across JavaScript engines, and a force
 * simulation is chaotic: a last-bit difference on tick one is a visibly
 * different picture by tick three hundred. Rendering it server-side would
 * therefore hydrate against a subtly different layout in any browser whose
 * engine is not Node's. Gating on mount also keeps a few hundred milliseconds
 * of physics off the server, where it buys nothing.
 */
export function GraphView(props: Props) {
  const hydrated = useHydrated()
  if (!hydrated) return <div className="sb-graph-placeholder" aria-hidden />
  return <GraphCanvas {...props} />
}

function GraphCanvas({ graph, activeEntityId, onSelect }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)

  /* ------------------------------------------------------------- the model */

  const model = useMemo(() => buildModel(graph), [graph])
  const { sim, index, labels, neighbours } = model

  /* --------------------------------------------------------- the frame loop */

  // The simulation mutates in place; this counter is what asks React to look at
  // it again. Positions are read from the ref during render.
  const [, setFrame] = useState(0)
  const runningRef = useRef(false)

  useEffect(() => {
    let raf = 0
    const tick = () => {
      if (sim.alpha <= ALPHA_MIN) {
        runningRef.current = false
        return
      }
      step(sim)
      setFrame((n) => n + 1)
      raf = requestAnimationFrame(tick)
    }
    runningRef.current = true
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [sim])

  /** Re-heat after a drag, so the neighbourhood settles around the new place. */
  const warm = () => {
    reheat(sim)
    if (!runningRef.current) {
      runningRef.current = true
      const tick = () => {
        if (sim.alpha <= ALPHA_MIN) {
          runningRef.current = false
          return
        }
        step(sim)
        setFrame((n) => n + 1)
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }
  }

  /* ------------------------------------------------------------ the viewport */

  const [view, setView] = useState<{ sim: Sim; box: Box }>(() => ({ sim, box: bounds(sim) }))

  // A new graph is a new world: fit to it once, then leave the viewport alone
  // so panning and zooming survive selecting, filtering and re-rendering. The
  // viewport remembers which simulation it was fitted to, and refits during
  // render when that changes — not in an effect, which would paint one frame
  // of the new graph inside the old graph's viewBox first.
  if (view.sim !== sim) setView({ sim, box: bounds(sim) })
  const box = view.sim === sim ? view.box : bounds(sim)
  const setBox = (next: Box) => setView({ sim, box: next })

  /** Client pixels to world units, via the current viewBox. */
  const toWorld = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    // preserveAspectRatio="xMidYMid meet": the shorter axis is letterboxed, so
    // both axes share one scale and the excess is split either side.
    const scale = Math.max(box.width / rect.width, box.height / rect.height)
    const offsetX = (rect.width * scale - box.width) / 2
    const offsetY = (rect.height * scale - box.height) / 2
    return {
      x: box.x - offsetX + (clientX - rect.left) * scale,
      y: box.y - offsetY + (clientY - rect.top) * scale,
    }
  }

  const onWheel = (event: React.WheelEvent) => {
    const factor = Math.exp(event.deltaY * 0.0016)
    const width = clamp(box.width * factor, MIN_SPAN, MAX_SPAN)
    const scale = width / box.width
    const at = toWorld(event.clientX, event.clientY)
    setBox({
      x: at.x - (at.x - box.x) * scale,
      y: at.y - (at.y - box.y) * scale,
      width,
      height: box.height * scale,
    })
  }

  /* -------------------------------------------------------------- the pointer */

  const dragRef = useRef<
    | { kind: 'node'; node: number; pointerId: number }
    | { kind: 'pan'; fromX: number; fromY: number; box: Box; pointerId: number }
    | null
  >(null)
  // A press that never moves is a click; a press that moves is a drag. Both
  // start the same way, so the distinction is made on release.
  const movedRef = useRef(false)

  const onPointerDownNode = (event: React.PointerEvent, i: number) => {
    event.stopPropagation()
    ;(event.target as Element).setPointerCapture?.(event.pointerId)
    dragRef.current = { kind: 'node', node: i, pointerId: event.pointerId }
    movedRef.current = false
    pin(sim, i)
  }

  const onPointerDownBackground = (event: React.PointerEvent) => {
    ;(event.currentTarget as Element).setPointerCapture?.(event.pointerId)
    dragRef.current = {
      kind: 'pan',
      fromX: event.clientX,
      fromY: event.clientY,
      box,
      pointerId: event.pointerId,
    }
    movedRef.current = false
  }

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    movedRef.current = true

    if (drag.kind === 'node') {
      pin(sim, drag.node, toWorld(event.clientX, event.clientY))
      warm()
      return
    }

    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const scale = Math.max(drag.box.width / rect.width, drag.box.height / rect.height)
    setBox({
      ...drag.box,
      x: drag.box.x - (event.clientX - drag.fromX) * scale,
      y: drag.box.y - (event.clientY - drag.fromY) * scale,
    })
  }

  const onPointerUp = () => {
    const drag = dragRef.current
    dragRef.current = null
    if (drag?.kind === 'node') {
      release(sim, drag.node)
      warm()
    }
  }

  /* --------------------------------------------------------------- rendering */

  const [hovered, setHovered] = useState<string | null>(null)

  if (sim.nodes.length === 0) {
    return (
      <EmptyState
        title="Nothing to draw yet."
        note="Entities and the claims between them appear here as you add them."
      />
    )
  }

  /** The entity the picture is currently *about*: selected, or hovered. */
  const attention = activeEntityId ?? hovered
  const lit = attention ? (neighbours.get(attention) ?? new Set([attention])) : null
  const isLit = (id: string) => !lit || lit.has(id)
  const labelAll = sim.nodes.length <= LABEL_EVERYTHING_BELOW

  return (
    <svg
      ref={svgRef}
      className="sb-graph-svg"
      viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
      role="application"
      aria-label="Relationship graph"
      onWheel={onWheel}
      onPointerDown={onPointerDownBackground}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      data-dimming={lit !== null}
    >
      <g className="sb-graph-edges">
        {model.edges.map((edge) => {
          const a = sim.nodes[edge.a]!
          const b = sim.nodes[edge.b]!
          const on = isLit(a.id) && isLit(b.id)
          return (
            <g key={edge.id} className={`sb-graph-edge${on ? '' : ' sb-graph-edge--dim'}`}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
              {/* A verb on every line is unreadable; on the lines you are
                  actually looking at, it is the whole point. */}
              {attention && on && (
                <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} textAnchor="middle">
                  {edge.label}
                </text>
              )}
            </g>
          )
        })}
      </g>

      <g className="sb-graph-nodes">
        {sim.nodes.map((node, i) => {
          const on = isLit(node.id)
          const active = node.id === activeEntityId
          const entityId = node.kind === 'entity' ? node.id : index.attributeOwner.get(node.id)!
          const label = labels.get(node.id) ?? ''
          const showLabel =
            node.kind === 'entity'
              ? labelAll || active || hovered === node.id || (attention !== null && on)
              : attention !== null && on

          return (
            <g
              key={node.id}
              className={[
                'sb-graph-node',
                node.kind === 'attribute' ? 'sb-graph-node--attr' : '',
                active ? 'sb-graph-node--on' : '',
                on ? '' : 'sb-graph-node--dim',
              ]
                .filter(Boolean)
                .join(' ')}
              onPointerDown={(event) => onPointerDownNode(event, i)}
              onPointerEnter={() => setHovered(entityId)}
              onPointerLeave={() => setHovered((was) => (was === entityId ? null : was))}
              onClick={(event) => {
                event.stopPropagation()
                // A drag that ends over a node is not a click on it.
                if (movedRef.current) return
                onSelect(activeEntityId === entityId ? null : entityId)
              }}
            >
              {node.kind === 'entity' ? (
                <circle cx={node.x} cy={node.y} r={node.radius} />
              ) : (
                <rect
                  x={node.x - node.radius}
                  y={node.y - node.radius}
                  width={node.radius * 2}
                  height={node.radius * 2}
                  transform={`rotate(45 ${node.x} ${node.y})`}
                />
              )}
              {showLabel && (
                <text
                  x={node.x}
                  y={node.y + node.radius + 11}
                  textAnchor="middle"
                  className={node.kind === 'attribute' ? 'sb-graph-label--attr' : undefined}
                >
                  {label}
                </text>
              )}
            </g>
          )
        })}
      </g>
    </svg>
  )
}

/* ------------------------------------------------------------------ helpers */

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Everything the renderer needs, derived once per graph: the simulation, the
 * labels, who is adjacent to whom, and which entity an attribute leaf belongs
 * to. Rebuilding this is what a *new* graph means; selecting is not that.
 */
function buildModel(graph: Graph) {
  const order = new Map<string, number>()
  const labels = new Map<string, string>()
  const attributeOwner = new Map<string, string>()

  type Seed = { id: string; kind: 'entity' | 'attribute'; radius: number }

  const nodes: Seed[] = graph.nodes.map((node, i) => {
    order.set(node.id, i)
    labels.set(node.id, node.name)
    return { id: node.id, kind: 'entity', radius: nodeRadius('entity', node.degree) }
  })

  const links: { a: number; b: number; distance: number }[] = []
  const edges: { id: string; a: number; b: number; label: string }[] = []

  for (const edge of graph.edges) {
    const a = order.get(edge.sourceId)
    const b = order.get(edge.targetId)
    if (a === undefined || b === undefined) continue
    links.push({ a, b, distance: ENTITY_LINK_DISTANCE })
    edges.push({ id: edge.id, a, b, label: predicateText(edge.predicateLabel) })
  }

  for (const attribute of graph.attributes) {
    const owner = order.get(attribute.subjectId)
    if (owner === undefined) continue
    const i = nodes.length
    order.set(attribute.id, i)
    labels.set(attribute.id, attribute.value)
    attributeOwner.set(attribute.id, attribute.subjectId)
    nodes.push({ id: attribute.id, kind: 'attribute', radius: nodeRadius('attribute', 0) })
    links.push({ a: owner, b: i, distance: ATTRIBUTE_LINK_DISTANCE })
    edges.push({ id: attribute.id, a: owner, b: i, label: predicateText(attribute.predicateLabel) })
  }

  /**
   * For each entity: itself, the entities one relationship away, and its own
   * attribute leaves. This is the set that stays lit when it is selected.
   */
  const neighbours = new Map<string, Set<string>>()
  const near = (id: string) => {
    let set = neighbours.get(id)
    if (!set) {
      set = new Set([id])
      neighbours.set(id, set)
    }
    return set
  }
  for (const node of graph.nodes) near(node.id)
  for (const edge of graph.edges) {
    near(edge.sourceId).add(edge.targetId)
    near(edge.targetId).add(edge.sourceId)
  }
  for (const attribute of graph.attributes) near(attribute.subjectId).add(attribute.id)

  const sim: Sim = createSim(nodes, links)
  settle(sim)

  return { sim, edges, labels, neighbours, index: { attributeOwner } }
}
