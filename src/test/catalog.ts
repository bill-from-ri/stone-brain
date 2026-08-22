import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { PGlite } from '@electric-sql/pglite'
import { ENTITY_TYPES, deriveOntology } from '@/lib/ontology/registry'

/**
 * A real Postgres with the real schema, for tests whose subject *is* the
 * catalog — the generated columns, the signature foreign key, the fingerprint
 * index. PGlite is Postgres compiled to WASM: same planner, same constraint
 * semantics, no daemon and no container.
 *
 * This lives here rather than in `src/lib/ontology/seed.ts` because that module
 * binds to the Neon-backed `db` singleton, and a test wants its own database.
 * It was duplicated across two test files before it was extracted; a third copy
 * was what made it worth moving.
 */

const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url))

/**
 * Apply every migration in order, exactly as `drizzle-kit migrate` would.
 *
 * Running the real files rather than pushing the schema is the point: it also
 * catches a migration that Drizzle generated but Postgres will not accept.
 */
export async function applyMigrations(db: PGlite): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    const sql = readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8')
    for (const statement of sql.split('--> statement-breakpoint')) {
      if (statement.trim()) await db.exec(statement)
    }
  }
}

/**
 * Seed the three global reference tables from the registry.
 *
 * Predicates go in twice — once without `inverse_name`, then an update — because
 * `predicates_inverse_fk` points at the same table, so `rules` cannot name
 * `ruled_by` before `ruled_by` exists. Ordering the array to avoid it would work
 * until someone added a pair in the wrong order.
 */
export async function seedCatalog(db: PGlite): Promise<void> {
  const { predicates, signatures } = deriveOntology()

  for (const [i, type] of ENTITY_TYPES.entries()) {
    await db.query(
      `insert into entity_types (name, label, plural_label, description, sort_order)
       values ($1, $2, $3, $4, $5)`,
      [type.name, type.label, type.pluralLabel, type.description, i],
    )
  }

  for (const p of predicates) {
    await db.query(
      `insert into predicates
         (name, kind, label, description, is_symmetric, is_temporal, is_functional,
          value_type, value_enum, unit)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        p.name, p.kind, p.label, p.description, p.isSymmetric, p.isTemporal,
        p.isFunctional, p.valueType, p.valueEnum ? JSON.stringify(p.valueEnum) : null, p.unit,
      ],
    )
  }

  for (const p of predicates) {
    if (!p.inverseName) continue
    await db.query(`update predicates set inverse_name = $2 where name = $1`, [
      p.name,
      p.inverseName,
    ])
  }

  for (const s of signatures) {
    await db.query(
      `insert into predicate_signatures (predicate, subject_type, object_type, value_kind)
       values ($1, $2, $3, $4)`,
      [s.predicate, s.subjectType, s.objectType, s.valueKind],
    )
  }
}
