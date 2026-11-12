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
 * reaches the graph. `--write` runs the same `runExtraction` service the
 * Library's Extract button does (src/lib/extraction), so a run from here is
 * recorded like any other — its row, its dropped claims, its proposals — and
 * shows up on the document. The write is additive and idempotent (§3), so
 * running it twice on an unchanged document creates nothing the second time.
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
const { createRunner } = await import('@/lib/extraction/pipeline')
const { runnerDeps } = await import('@/lib/extraction/run')
type ModelRun = import('@/lib/llm/extract').ExtractionRun

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
const describeText = (text: Awaited<ReturnType<typeof readDocumentText>>) =>
  console.error(
    `text     : ${text.paragraphs.length} paragraphs, ${text.markdown.length} chars ` +
      `(${text.strippedBytes.toLocaleString()} bytes of images dropped)`,
  )

const started = Date.now()

function printRun(run: ModelRun) {
  console.error(
    `run      : ${run.claims.length} claims, ${run.rejections.length} rejected, ` +
      `${run.proposals.length} proposed predicates, ` +
      `${run.attempts} attempt(s), ${((Date.now() - started) / 1000).toFixed(1)}s, ` +
      `format "${run.responseFormat ?? 'text'}", ` +
      `${run.usage.promptTokens}+${run.usage.completionTokens} tokens, model "${run.model}"`,
  )

  if (json) {
    console.log(JSON.stringify(run, null, 2))
    return
  }
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
  for (const p of run.proposals) {
    const sig = p.objectType ? `${p.subjectType} -> ${p.objectType}` : `${p.subjectType} attribute`
    console.log(`  PROPOSED ${p.name} (${sig}): ${p.description}`)
    if (p.quote) console.log(`      P${p.paragraphIndex ?? '?'} "${p.quote.slice(0, 110)}"`)
  }
}

if (!write) {
  const text = await readDocumentText(client, doc.driveFileId)
  describeText(text)

  let run: ModelRun
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

  printRun(run)
  console.error('\nDry run — nothing written. Pass --write to store this extraction.')
  process.exit(0)
}

/*
 * The write path is the product's own service, with two taps: the model
 * override replaces the stored model id, and the reply is captured on its way
 * through so the claims can be printed as the dry run prints them.
 */
let captured: ModelRun | undefined
const runExtraction = createRunner({
  ...runnerDeps,
  credentials: async () => creds,
  readText: async () => {
    const text = await readDocumentText(client, doc.driveFileId)
    describeText(text)
    return text
  },
  extract: async (c, input) => (captured = await extractClaims(c, input)),
})

const outcome = await runExtraction(user.id, doc.id)
if (!outcome.ok) {
  console.error(`\nREFUSED (${outcome.refusal}): ${outcome.message}`)
  process.exit(1)
}
if (captured) printRun(captured)

const summary = outcome.run
if (summary.failure) {
  console.error(`\nFAILED (${summary.failure.code}): ${summary.failure.message}`)
  console.error(`recorded : run ${summary.runId}`)
  process.exit(1)
}

console.error(
  `\nwritten  : ${summary.claimsCreated} new claims, ${summary.claimsAlreadyPresent} already present, ` +
    `${summary.inversesCreated} inverses, ${summary.entitiesCreated} draft entities, ` +
    `${summary.dropped} dropped, ${summary.proposalsFiled} proposals filed`,
)
console.error(`recorded : run ${summary.runId}`)

process.exit(0)
