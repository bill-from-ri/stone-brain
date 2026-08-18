'use client'

import type { EntityRow, EntityTypeOption } from '@/db/queries/claims'
import { EntityRail } from '@/components/shared/EntityRail'
import { useWorldSelection } from '@/components/world/WorldSelection'

/**
 * The World's left rail: the shared EntityRail, wired to the screen's selection.
 *
 * It sits on Claims rather than only on Graph because "show me everything about
 * X" is the question this screen is actually for, and the prototype's Claims
 * view had no way to ask it — it only ever showed one document's extraction.
 */
export function EntityFilter({
  entities,
  entityTypes,
  typeCounts,
}: {
  entities: EntityRow[]
  entityTypes: EntityTypeOption[]
  typeCounts: Record<string, number>
}) {
  const { entityId, selectEntity } = useWorldSelection()

  return (
    <EntityRail
      entities={entities.map((e) => ({
        id: e.id,
        name: e.name,
        entityType: e.entityType,
        count: e.claimCount,
        variants: e.nameVariants,
      }))}
      entityTypes={entityTypes}
      typeCounts={typeCounts}
      activeId={entityId}
      onSelect={selectEntity}
    />
  )
}
