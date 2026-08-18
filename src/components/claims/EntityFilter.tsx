'use client'

import type { EntityRow, EntityTypeOption } from '@/db/queries/claims'
import { EntityRail } from '@/components/shared/EntityRail'
import { useParamWriter } from '@/components/shared/RecordTable'

/**
 * Claims' left rail: the shared EntityRail, wired to the query string.
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
  const setParams = useParamWriter()

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
      activeId={activeEntityId}
      onSelect={(id) =>
        setParams((p) => {
          if (id) p.set('entity', id)
          else p.delete('entity')
          p.delete('claim')
        })
      }
    />
  )
}
