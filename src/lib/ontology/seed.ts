import { eq, inArray, notInArray, sql } from 'drizzle-orm'
import type { NeonDatabase } from 'drizzle-orm/neon-serverless'
import type * as schema from '@/db/schema'
import { entityTypes, predicateSignatures, predicates } from '@/db/schema'
import { ENTITY_TYPES, deriveOntology } from './registry'

/**
 * The handle is a parameter rather than an import of `@/db`, which is what
 * lets `npm run db:seed` open its own connection and run this outside Next —
 * `@/db` is a `server-only` singleton and throws when imported from a script.
 */
type Db = NeonDatabase<typeof schema>

/** `excluded.<col>` — the value the rejected INSERT was carrying. */
const excluded = (column: string) => sql.raw(`excluded.${column}`)

export type SeedReport = {
  entityTypes: number
  predicates: number
  signatures: number
  /** Rows dropped from the registry and successfully removed. */
  pruned: string[]
  /** Rows dropped from the registry that claims still depend on, so kept. */
  retained: string[]
}

/**
 * Syncs `src/lib/ontology/registry.ts` into the three global reference tables.
 *
 * The vocabulary is one curated set shared by every user, so this runs against
 * the database rather than against an account — there is nothing per-user to
 * seed, and a new signup needs no ontology setup at all.
 *
 * It is a **sync, not an insert**: idempotent, safe to run on every deploy, and
 * the way a registry edit reaches production. Run it with `npm run db:seed`,
 * after `db:migrate`.
 *
 * Rows the registry no longer declares are pruned — but only if nothing points
 * at them. A predicate with claims hanging off it is *retained and reported*
 * rather than deleted: the foreign keys would refuse the delete anyway, and
 * failing the whole sync over one retired predicate would be worse than saying
 * so plainly. Retiring one for real means migrating its claims first.
 */
export async function seedOntology(db: Db): Promise<SeedReport> {
  const { predicates: predicateRows, signatures } = deriveOntology()

  return db.transaction(async (tx) => {
    await tx
      .insert(entityTypes)
      .values(
        ENTITY_TYPES.map((t, i) => ({
          name: t.name,
          label: t.label,
          pluralLabel: t.pluralLabel,
          description: t.description,
          sortOrder: i,
        })),
      )
      .onConflictDoUpdate({
        target: entityTypes.name,
        set: {
          label: excluded('label'),
          pluralLabel: excluded('plural_label'),
          description: excluded('description'),
          sortOrder: excluded('sort_order'),
        },
      })

    /**
     * Predicates land before signatures, which reference them — and in two
     * passes, because `inverse_name` is a self-referencing foreign key:
     * `member_of` names `has_member` as its inverse before that row exists.
     */
    await tx
      .insert(predicates)
      .values(predicateRows.map((p) => ({ ...p, inverseName: null })))
      .onConflictDoUpdate({
        target: predicates.name,
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
      })

    for (const p of predicateRows) {
      if (!p.inverseName) continue
      await tx.update(predicates).set({ inverseName: p.inverseName }).where(eq(predicates.name, p.name))
    }

    await tx.insert(predicateSignatures).values(signatures).onConflictDoNothing()

    /* ------------------------------------------------------------- pruning */

    const pruned: string[] = []
    const retained: string[] = []

    // Signatures first: a stale one would otherwise keep its predicate alive.
    const liveSignatures = signatures.map(
      (s) => sql`(${s.predicate}, ${s.subjectType}, ${s.objectType}, ${s.valueKind})`,
    )
    const staleSignatures = await tx.execute<{
      predicate: string
      subject_type: string
      object_type: string
      value_kind: string
    }>(sql`
      select predicate, subject_type, object_type, value_kind
      from predicate_signatures
      where (predicate, subject_type, object_type, value_kind) not in (${sql.join(liveSignatures, sql`, `)})
    `)

    for (const row of staleSignatures.rows) {
      const label = `${row.predicate}: ${row.subject_type} → ${row.object_type}/${row.value_kind}`
      const used = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from claims
        where predicate = ${row.predicate}
          and subject_type = ${row.subject_type}
          and object_type_key = ${row.object_type}
          and value_kind = ${row.value_kind}
      `)
      if ((used.rows[0]?.n ?? 0) > 0) {
        retained.push(label)
        continue
      }
      await tx.execute(sql`
        delete from predicate_signatures
        where predicate = ${row.predicate} and subject_type = ${row.subject_type}
          and object_type = ${row.object_type} and value_kind = ${row.value_kind}
      `)
      pruned.push(label)
    }

    const liveNames = predicateRows.map((p) => p.name)
    const stalePredicates = await tx
      .select({ name: predicates.name })
      .from(predicates)
      .where(notInArray(predicates.name, liveNames))

    for (const { name } of stalePredicates) {
      const used = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from claims where predicate = ${name}`,
      )
      if ((used.rows[0]?.n ?? 0) > 0) {
        retained.push(name)
        continue
      }
      // Clear any inverse pointing at it first, or its own FK blocks the delete.
      await tx.update(predicates).set({ inverseName: null }).where(eq(predicates.inverseName, name))
      await tx.delete(predicates).where(eq(predicates.name, name))
      pruned.push(name)
    }

    const liveTypes = ENTITY_TYPES.map((t) => t.name)
    const staleTypes = await tx
      .select({ name: entityTypes.name })
      .from(entityTypes)
      .where(notInArray(entityTypes.name, liveTypes))

    for (const { name } of staleTypes) {
      const used = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from entities where entity_type = ${name}`,
      )
      if ((used.rows[0]?.n ?? 0) > 0) {
        retained.push(name)
        continue
      }
      await tx.delete(entityTypes).where(inArray(entityTypes.name, [name]))
      pruned.push(name)
    }

    return {
      entityTypes: ENTITY_TYPES.length,
      predicates: predicateRows.length,
      signatures: signatures.length,
      pruned,
      retained,
    }
  })
}
