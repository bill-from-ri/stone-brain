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
 * ## A model that is not the configured provider
 *
 * Two flags split the run in half, as `capture-extraction.ts` does for scoring,
 * so the reply can come from a model reached some other way than the
 * OpenAI-compatible endpoint in Settings:
 *
 *   --dump-prompt=<dir>   write `<slug>.system.txt` and `<slug>.user.txt` (the
 *                         exact strings `extractClaims` would send) and stop.
 *   --from-reply=<file>   take the model's reply from a file instead of a
 *                         provider, through the same `extractJson` +
 *                         `parseExtraction` path a live reply takes. Needs
 *                         `--model=<name>`, which is what the run is recorded
 *                         under. One attempt, no repair round.
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
const flag = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const promptDir = flag('dump-prompt')
const replyFile = flag('from-reply')
const query = args.filter((a) => !a.startsWith('--')).join(' ').trim()

if (!query || (replyFile && !modelOverride)) {
  console.error(
    'Usage: npm run extract -- "<document name>" [--write] [--json] [--model=<id>]\n' +
      '       [--dump-prompt=<dir> | --from-reply=<file> --model=<name>]',
  )
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
const { extractClaims, extractJson, ExtractionError } = await import('@/lib/llm/extract')
const { extractionSystemPrompt, extractionUserPrompt } = await import('@/lib/llm/prompt')
const { parseExtraction } = await import('@/lib/ontology/extraction')
const { loadExistingClaims } = await import('@/lib/ontology/existing-claims')
const fs = await import('node:fs')
const path = await import('node:path')
const { ProviderError } = await import('@/lib/llm/errors')
const { coreOntology } = await import('@/lib/ontology/extraction')
const { createRunner } = await import('@/lib/extraction/pipeline')
const { runnerDeps } = await import('@/lib/extraction/run')
type ModelRun = import('@/lib/llm/extract').ExtractionRun
type ExtractionInput = import('@/lib/llm/extract').ExtractionInput

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

const client = await DriveClient.forUser(user.id)

if (promptDir) {
  const text = await readDocumentText(client, doc.driveFileId)
  const slug = doc.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  fs.mkdirSync(promptDir, { recursive: true })
  fs.writeFileSync(path.join(promptDir, `${slug}.system.txt`), extractionSystemPrompt(coreOntology()))
  // With the document's existing claims, as a re-extraction would send it.
  const existing = await loadExistingClaims(db, user.id, doc.id, text.paragraphs)
  fs.writeFileSync(
    path.join(promptDir, `${slug}.user.txt`),
    extractionUserPrompt(doc.name, text.paragraphs, existing),
  )
  console.error(`${doc.name}: prompts written to ${promptDir}/${slug}.* (${text.paragraphs.length} paragraphs)`)
  process.exit(0)
}

const stored = await getProviderCredentials(user.id)
if (!stored && !replyFile) throw new Error(`No provider configured for ${user.email}.`)
// A reply from a file never reaches the stored provider, so it borrows nothing
// from it: the run is recorded under the model that actually wrote the reply.
const creds = replyFile
  ? { ...stored, apiKey: '', baseUrl: 'offline', modelId: modelOverride! }
  : modelOverride
    ? { ...stored!, modelId: modelOverride }
    : stored!

/** The model step: a live call, or a saved reply taken down the same path. */
async function extract(c: typeof creds, input: ExtractionInput): Promise<ModelRun> {
  if (!replyFile) return extractClaims(c as Parameters<typeof extractClaims>[0], input)
  const reply = fs.readFileSync(replyFile, 'utf8')
  const payload = extractJson(reply)
  if (payload === undefined) {
    throw new ExtractionError('unusable_response', 'The saved reply is not JSON.', reply)
  }
  const handles = new Set((input.existingClaims ?? []).map((c) => c.handle))
  const parsed = parseExtraction(payload, input.ontology, handles)
  return {
    claims: parsed.claims,
    retractions: parsed.retractions,
    rejections: parsed.rejections,
    proposals: parsed.proposals,
    model: modelOverride!,
    attempts: 1,
    responseFormat: null,
    usage: { promptTokens: 0, completionTokens: 0 },
  }
}

console.error(`document : ${doc.name}`)
console.error(`provider : ${creds.modelId} @ ${creds.baseUrl}`)

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
  for (const r of run.retractions ?? []) {
    console.log(`  RETRACT ${r.handle}: ${r.reason}`)
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
    run = await extract(creds, {
      documentName: doc.name,
      paragraphs: text.paragraphs,
      ontology: coreOntology(),
      // A dry run is shown what a real run would be, re-extraction included.
      existingClaims: await loadExistingClaims(db, user.id, doc.id, text.paragraphs),
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
  credentials: async () => creds as Parameters<typeof extractClaims>[0],
  // A saved reply says nothing about whether the stored provider is healthy.
  ...(replyFile ? { recordHealth: async () => {} } : {}),
  readText: async () => {
    const text = await readDocumentText(client, doc.driveFileId)
    describeText(text)
    return text
  },
  extract: async (c, input) => (captured = await extract(c, input)),
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
    `${summary.dropped} dropped, ${summary.proposalsFiled} proposals filed` +
    (summary.claimsKept > 0 || summary.claimsRetracted > 0
      ? `; ${summary.claimsKept} kept, ${summary.claimsRetracted} retracted`
      : ''),
)
console.error(`recorded : run ${summary.runId}`)

process.exit(0)
