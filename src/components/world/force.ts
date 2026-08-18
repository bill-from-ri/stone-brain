/**
 * A small force-directed layout, kept deliberately separate from the renderer.
 *
 * Why hand-rolled rather than d3-force: the whole simulation is the sixty lines
 * below, it has no dependencies, and — more importantly — it is *deterministic*.
 * Starting positions come from a phyllotaxis spiral rather than a random
 * scatter, so the same graph settles into the same picture every time you open
 * it. That matters more here than in most graph views: this is a tool for
 * checking a world for contradictions, and you cannot build a mental map of
 * something that rearranges itself on every navigation.
 *
 * Nothing in this file touches React or the DOM. The renderer owns the frame
 * loop and calls `step`; swapping SVG for canvas later changes nothing here.
 */

export type SimNode = {
  id: string
  /** Attributes are leaves: lighter, closer in, and drawn as diamonds. */
  kind: 'entity' | 'attribute'
  radius: number
  x: number
  y: number
  vx: number
  vy: number
  /** True while a pointer is holding it. Fixed nodes take no forces. */
  fixed: boolean
}

/** Indices into the node array, not ids — the inner loop runs every frame. */
export type SimLink = { a: number; b: number; distance: number }

export type Sim = {
  nodes: SimNode[]
  links: SimLink[]
  alpha: number
}

/** Repulsion between every pair, as charge / distance². */
const CHARGE = 9000
/** Below this separation the inverse-square term is clamped, or nodes rocket. */
const MIN_DISTANCE_SQ = 400
const LINK_STRENGTH = 0.09
/** Pulls the whole drawing back toward the origin so nothing drifts away. */
const GRAVITY = 0.024
const DAMPING = 0.82
const ALPHA_DECAY = 0.98
export const ALPHA_MIN = 0.005
/** What a drag or a re-layout re-heats to: warm enough to move, not to fling. */
export const ALPHA_WARM = 0.35

export const ENTITY_LINK_DISTANCE = 118
export const ATTRIBUTE_LINK_DISTANCE = 52

/** The golden angle. Successive points at this turn never line up. */
const PHYLLOTAXIS_ANGLE = 2.399963229728653

export function nodeRadius(kind: 'entity' | 'attribute', degree: number): number {
  if (kind === 'attribute') return 4.5
  return 9 + Math.min(degree, 24) * 0.62
}

export function createSim(
  nodes: Omit<SimNode, 'x' | 'y' | 'vx' | 'vy' | 'fixed'>[],
  links: SimLink[],
): Sim {
  return {
    nodes: nodes.map((node, i) => {
      // A phyllotaxis spiral: even, symmetric-breaking, and the same every run.
      const angle = i * PHYLLOTAXIS_ANGLE
      const radius = 16 * Math.sqrt(i)
      return {
        ...node,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
        fixed: false,
      }
    }),
    links,
    alpha: 1,
  }
}

/** One tick. Mutates in place — this runs sixty times a second. */
export function step(sim: Sim): void {
  const { nodes, links, alpha } = sim
  const n = nodes.length

  for (let i = 0; i < n; i++) {
    const a = nodes[i]!
    for (let j = i + 1; j < n; j++) {
      const b = nodes[j]!
      let dx = b.x - a.x
      let dy = b.y - a.y
      let dsq = dx * dx + dy * dy

      // Exactly coincident nodes have no direction to separate along. Nudging
      // by index rather than at random keeps the run reproducible.
      if (dsq === 0) {
        dx = 0.5 + (i % 7) * 0.1
        dy = 0.5 + (j % 5) * 0.1
        dsq = dx * dx + dy * dy
      }

      const d = Math.sqrt(dsq)
      const force = (CHARGE * alpha) / Math.max(dsq, MIN_DISTANCE_SQ)
      const fx = (dx / d) * force
      const fy = (dy / d) * force
      a.vx -= fx
      a.vy -= fy
      b.vx += fx
      b.vy += fy
    }
  }

  for (const link of links) {
    const a = nodes[link.a]!
    const b = nodes[link.b]!
    const dx = b.x - a.x
    const dy = b.y - a.y
    const d = Math.hypot(dx, dy) || 1
    const force = (d - link.distance) * LINK_STRENGTH * alpha
    const fx = (dx / d) * force
    const fy = (dy / d) * force
    a.vx += fx
    a.vy += fy
    b.vx -= fx
    b.vy -= fy
  }

  for (const node of nodes) {
    if (node.fixed) {
      node.vx = 0
      node.vy = 0
      continue
    }
    node.vx -= node.x * GRAVITY * alpha
    node.vy -= node.y * GRAVITY * alpha
    node.vx *= DAMPING
    node.vy *= DAMPING
    node.x += node.vx
    node.y += node.vy
  }

  sim.alpha = alpha * ALPHA_DECAY
}

/**
 * Settle the layout before the first paint.
 *
 * The tick budget shrinks as the graph grows because each tick is O(n²): a
 * fifty-node world can afford to converge fully, a five-hundred-node one gets
 * it most of the way there and finishes on screen.
 */
export function settle(sim: Sim): void {
  const ticks = Math.max(140, Math.min(360, Math.round(90_000 / Math.max(sim.nodes.length, 1))))
  for (let i = 0; i < ticks && sim.alpha > ALPHA_MIN; i++) step(sim)
}

/** The drawing's bounding box, padded, for fitting the viewBox to it. */
export function bounds(sim: Sim, padding = 60) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const node of sim.nodes) {
    minX = Math.min(minX, node.x - node.radius)
    minY = Math.min(minY, node.y - node.radius)
    maxX = Math.max(maxX, node.x + node.radius)
    maxY = Math.max(maxY, node.y + node.radius)
  }

  if (!Number.isFinite(minX)) return { x: -200, y: -150, width: 400, height: 300 }

  return {
    x: minX - padding,
    y: minY - padding,
    width: Math.max(maxX - minX + padding * 2, 120),
    height: Math.max(maxY - minY + padding * 2, 90),
  }
}
