import { AppHeader } from '@/components/shell/AppHeader'
import { GraphCanvas } from '@/components/graph/GraphCanvas'
import { getEntityTypeCounts, getEntityTypes, getGraph } from '@/db/queries/claims'
import { requireReady } from '@/lib/auth/guard'

export const dynamic = 'force-dynamic'

/**
 * The Graph screen, from the prototype's GRAPH view (lines 619-700).
 *
 * The prototype drew a hand-placed SVG around one hub entity. This keeps its
 * shape — type filters and a most-connected list on the left, a node-and-edge
 * canvas on the right — but lays the nodes out from the real graph.
 *
 * Its era slider is deliberately absent. Filtering by date needs the claim
 * ordinals to mean something across the corpus, and most of the seeded claims
 * carry no date at all; a slider that silently hid undated claims would misread
 * as "nothing happened then".
 */
export default async function GraphPage() {
  const session = await requireReady()
  const userId = session.user.id

  const [graph, entityTypes, typeCounts] = await Promise.all([
    getGraph(userId),
    getEntityTypes(),
    getEntityTypeCounts(userId),
  ])

  return (
    <>
      <AppHeader title="Graph" />
      <GraphCanvas
        nodes={graph.nodes}
        edges={graph.edges}
        entityTypes={entityTypes}
        typeCounts={Object.fromEntries(typeCounts)}
      />
    </>
  )
}
