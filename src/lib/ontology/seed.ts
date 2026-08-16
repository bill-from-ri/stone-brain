import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { entityTypes, predicates, predicateSignatures } from '@/db/schema'
import { ENTITY_TYPES, deriveOntology } from './registry'

/** `excluded.<col>` — the value the rejected INSERT was carrying. */
const excluded = (column: string) => sql.raw(`excluded.${column}`)

/**
 * Materialises the registry into this user's three reference tables.
 *
 * The vocabulary is per-user (see the ontology note in src/db/schema.ts), so
 * every user gets their own copy of the core predicates and can then extend or
 * edit them without touching anyone else's world.
 *
 * Idempotent, and safe to call on every entry into the Claims UI: core rows are
 * upserted so a registry edit propagates on the next run, while anything the
 * user added or edited themselves (`is_core = false`) is left alone. Removals
 * from the registry are deliberately NOT propagated — a predicate with claims
 * hanging off it must be retired deliberately, not silently dropped.
 */
export async function seedOntology(userId: string): Promise<void> {
  const { predicates: predicateRows, signatures } = deriveOntology()

  await db.transaction(async (tx) => {
    await tx
      .insert(entityTypes)
      .values(
        ENTITY_TYPES.map((t, i) => ({
          userId,
          name: t.name,
          label: t.label,
          pluralLabel: t.pluralLabel,
          description: t.description,
          sortOrder: i,
          isCore: true,
        })),
      )
      .onConflictDoUpdate({
        target: [entityTypes.userId, entityTypes.name],
        set: {
          label: excluded('label'),
          pluralLabel: excluded('plural_label'),
          description: excluded('description'),
          sortOrder: excluded('sort_order'),
        },
        setWhere: eq(entityTypes.isCore, true),
      })

    /**
     * Predicates land before signatures, which FK to them — and in two passes,
     * because `inverse_name` is a self-referencing FK: `member_of` names
     * `has_member` as its inverse before that row exists.
     */
    await tx
      .insert(predicates)
      .values(predicateRows.map((p) => ({ ...p, userId, inverseName: null, isCore: true })))
      .onConflictDoUpdate({
        target: [predicates.userId, predicates.name],
        set: {
          kind: excluded('kind'),
          label: excluded('label'),
          description: excluded('description'),
          isSymmetric: excluded('is_symmetric'),
          isTemporal: excluded('is_temporal'),
          isFunctional: excluded('is_functional'),
          valueType: excluded('value_type'),
          valueEnum: excluded('value_enum'),
          unit: excluded('unit'),
        },
        setWhere: eq(predicates.isCore, true),
      })

    for (const p of predicateRows) {
      if (!p.inverseName) continue
      await tx
        .update(predicates)
        .set({ inverseName: p.inverseName })
        .where(and(eq(predicates.userId, userId), eq(predicates.name, p.name), eq(predicates.isCore, true)))
    }

    await tx
      .insert(predicateSignatures)
      .values(signatures.map((s) => ({ ...s, userId })))
      .onConflictDoNothing()
  })
}
