import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRequireReady } from '@/lib/auth/guard'
import {
  getClaim,
  getEntities,
  getEntityTypes,
  getPredicates,
  getSignatures,
} from '@/db/queries/claims'

const paramsSchema = z.object({ id: z.uuid() })

/**
 * What the claim editor needs to edit one claim: the claim, and the choices
 * open to it.
 *
 * Fetched when Edit is pressed rather than shipped with every claim pane. The
 * pane is drawn from the clicked table row and knows nothing of the entity
 * list or the ontology, and most panes are read, not edited — so paying for
 * the pickers up front on every selection would be paying for nothing.
 *
 * Narrowed here to this claim's subject and predicate, which an edit cannot
 * change: the editor gets one predicate, the signatures for it from this
 * subject's type, and only the entities that could stand at the other end.
 * The same pickers as a new claim, with the fixed parts already chosen.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await apiRequireReady()
  if (!guard.ok) return guard.response

  const parsed = paramsSchema.safeParse(await context.params)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Malformed request.' }, { status: 400 })
  }

  const userId = guard.session.user.id
  const [claim, allEntities, entityTypes, predicates, allSignatures] = await Promise.all([
    getClaim(userId, parsed.data.id),
    getEntities(userId),
    getEntityTypes(),
    getPredicates(),
    getSignatures(),
  ])

  if (!claim) return NextResponse.json({ ok: false, error: 'No such claim.' }, { status: 404 })

  const signatures = allSignatures.filter(
    (s) => s.predicate === claim.predicate && s.subjectType === claim.subjectType,
  )
  const objectTypes = new Set(signatures.map((s) => s.objectType))

  const entities = allEntities
    .filter((e) => e.id === claim.subjectId || objectTypes.has(e.entityType))
    .map((e) => ({ id: e.id, name: e.name, entityType: e.entityType }))

  return NextResponse.json({
    ok: true,
    claim,
    entities,
    entityTypes,
    predicates: predicates.filter((p) => p.name === claim.predicate),
    signatures,
  })
}
