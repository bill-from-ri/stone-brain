/**
 * `npm run extract -- "<document name>" [--write]` — run one real document
 * through the whole Phase 2B path against the real provider.
 *
 * This is the harness Phase 2B §4 was verified with, and the one §7's model
 * comparison will drive: the pieces either side of the model (§2's export, §3's write) are
 * covered by unit tests against a real Postgres, but "does this provider honour
 * `response_format` for a 70-value enum" is not a question a test can answer —
 * only a provider can.
 *
 * **Dry run by default.** Without `--write` it stops after validation and prints
 * what came back, so the expensive half can be inspected before anything
 * reaches the graph. `--write` calls `writeExtraction()`, which is additive and
 * idempotent (§3), so running it twice on an unchanged document is a no-op.
 *
 * Needs `--conditions=react-server`: this reaches into `server-only` modules —
 * the Drive client and the provider store — which throw on import outside
 * Next's server bundle. See the npm script.
 */

import { config as loadEnv } from 'dotenv'

loadEnv({ path: ['.env.local', '.env'], quiet: true })

const args = process.argv.slice(2)
const write = args.includes('--write')
const json = args.includes('--json')
/** Overrides the stored model id without touching the saved settings — §7's model-comparison knob. */
const modelOverride = args.find((a) => a.startsWith('--model='))?.slice('--model='.length)
const query = args.filter((a) => !a.startsWith('--')).join(' ').trim()

if (!query) {
  console.error('Usage: npm run extract -- "<document name>" [--write] [--json] [--model=<id>]')
  process.exit(1)
}

// Imported after dotenv, because `@/lib/env` validates the environment at
// import time and `@/db` builds its pool from it.
const { and, eq, ilike, isNull } = await import('drizzle-orm')
const { db } = await import('@/db')
const { documents, users } = await import('@/db/schema')
const { DriveClient } = await import('@/lib/drive/client')
const { readDocumentText } = await import('@/lib/documents/text')
const { getProviderCredentials } = await import('@/lib/llm/provider')
const { extractClaims, ExtractionError } = await import('@/lib/llm/extract')
const { ProviderError } = await import('@/lib/llm/errors')
const { coreOntology } = await import('@/lib/ontology/extraction')
const { writeExtraction } = await import('@/lib/ontology/extraction-write')

const [user] = await db.select({ id: users.id, email: users.email }).from(users).limit(2)
if (!user) throw new Error('No users in the database.')

const matches = await db
  .select({
    id: documents.id,
    name: documents.name,
    driveFileId: documents.driveFileId,
    driveVersion: documents.driveVersion,
  })
  .from(documents)
  .where(
    and(eq(documents.userId, user.id), isNull(documents.removedAt), ilike(documents.name, `%${query}%`)),
  )

if (matches.length === 0) throw new Error(`No document matching "${query}".`)
if (matches.length > 1) {
  throw new Error(
    `"${query}" matches ${matches.length} documents: ${matches.map((m) => m.name).join(', ')}`,
  )
}
const doc = matches[0]!

const stored = await getProviderCredentials(user.id)
if (!stored) throw new Error(`No provider configured for ${user.email}.`)
const creds = modelOverride ? { ...stored, modelId: modelOverride } : stored

console.error(`document : ${doc.name}`)
console.error(`provider : ${creds.modelId} @ ${creds.baseUrl}`)

const client = await DriveClient.forUser(user.id)
const text = await readDocumentText(client, doc.driveFileId)
console.error(
  `text     : ${text.paragraphs.length} paragraphs, ${text.markdown.length} chars ` +
    `(${text.strippedBytes.toLocaleString()} bytes of images dropped)`,
)

const started = Date.now()
let run
try {
  run = await extractClaims(creds, {
    documentName: doc.name,
    paragraphs: text.paragraphs,
    ontology: coreOntology(),
  })
} catch (err) {
  if (err instanceof ExtractionError) {
    console.error(`\nFAILED (${err.code}): ${err.message}`)
    if (err.raw) console.error(`\n--- raw reply ---\n${err.raw.slice(0, 4000)}`)
    process.exit(1)
  }
  if (err instanceof ProviderError) {
    console.error(`\nPROVIDER (${err.reason}): ${err.detail}`)
    process.exit(1)
  }
  throw err
}

console.error(
  `run      : ${run.claims.length} claims, ${run.rejections.length} rejected, ` +
    `${run.attempts} attempt(s), ${((Date.now() - started) / 1000).toFixed(1)}s, ` +
    `format "${run.responseFormat ?? 'text'}", ` +
    `${run.usage.promptTokens}+${run.usage.completionTokens} tokens, model "${run.model}"`,
)

if (json) {
  console.log(JSON.stringify(run, null, 2))
} else {
  for (const c of run.claims) {
    const object =
      c.objectName !== undefined
        ? `${c.objectName} (${c.objectType})`
        : String(c.valueInt ?? c.valueFloat ?? c.valueString ?? c.valueTime)
    const period = c.startTime || c.endTime ? `  [${c.startTime ?? ''}..${c.endTime ?? ''}]` : ''
    console.log(`  ${c.subjectName} (${c.subjectType}) --${c.predicate}--> ${object}${period}`)
    console.log(`      P${c.paragraphIndex ?? '?'} "${c.quote.slice(0, 110)}"`)
  }
  for (const r of run.rejections) {
    console.log(`  REJECTED [${r.index}] ${r.code}: ${r.message}`)
    console.log(`      ${JSON.stringify(r.received).slice(0, 200)}`)
  }
}

if (!write) {
  console.error('\nDry run — nothing written. Pass --write to store this extraction.')
  process.exit(0)
}

const result = await writeExtraction(db, user.id, run.claims, {
  documentId: doc.id,
  documentName: doc.name,
  headRevisionId: text.headRevisionId,
  driveVersion: doc.driveVersion,
  model: run.model,
})

console.error(
  `\nwritten  : ${result.claimsCreated} new claims, ${result.claimsAlreadyPresent} already present, ` +
    `${result.sourcesCreated} sources, ${result.entitiesCreated.length} draft entities, ` +
    `${result.unwritten.length} unwritten`,
)
for (const e of result.entitiesCreated) console.error(`  + ${e.entityType} "${e.name}"`)
for (const u of result.unwritten) console.error(`  ! ${u.code}: ${u.message}`)

process.exit(0)
