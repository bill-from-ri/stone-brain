/**
 * `npm run extract:capture -- <run-label> [seed ...]` — run extraction over the
 * hand-seeded documents and save what came back, for §4b's scoring.
 *
 * Capturing and scoring are separate on purpose: a capture spends free-tier
 * requests (20/day on `gemini-3.7-flash`), scoring spends none. Each document's
 * fixture records everything the scorer needs to stay honest about what it is
 * scoring — the model asked for and the model that answered, a hash of the
 * prompt, the Drive version read, and the paragraphs the model was shown — so
 * scoring can be re-run as the match rules change without re-capturing.
 *
 * **Never writes to the database.** Stops at the first provider error rather
 * than burning further requests on a key that is revoked or rate limited.
 *
 * Writes `scoring/captures/<run-label>/<seed>.json`, refusing to overwrite.
 *
 * ## Capturing a model that is not the configured provider
 *
 * Two flags split the run in half, so the reply can come from anywhere — a
 * model reached some other way than the OpenAI-compatible endpoint in Settings:
 *
 *   --dump-prompts=<dir>   write `<seed>.system.txt` and `<seed>.user.txt` (the
 *                          exact strings `extractClaims` would send) plus the
 *                          paragraphs, and stop without calling any model.
 *   --from-replies=<dir>   read `<seed>.reply.txt` from the same directory and
 *                          build the fixture from it, through the same
 *                          `extractJson` + `parseExtraction` path a live reply
 *                          takes. Needs `--model=<name>` for the record.
 *
 * A fixture built this way is one attempt with no repair round, and says so
 * (`attempts: 1`, `responseFormat: null`); its rejections are the first
 * reply's. The scorer reads both kinds identically.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { config as loadEnv } from 'dotenv'

loadEnv({ path: ['.env.local', '.env'], quiet: true })

const [label, ...wanted] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const flag = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const promptDir = flag('dump-prompts')
const replyDir = flag('from-replies')
const replyModel = flag('model')
if (!label || (replyDir && !replyModel)) {
  console.error(
    'Usage: npm run extract:capture -- <run-label> [seed ...] [--dump-prompts=<dir> | --from-replies=<dir> --model=<name>]',
  )
  process.exit(1)
}

const { eq } = await import('drizzle-orm')
const { db } = await import('@/db')
const { documents, users } = await import('@/db/schema')
const { DriveClient } = await import('@/lib/drive/client')
const { readDocumentText } = await import('@/lib/documents/text')
const { getProviderCredentials } = await import('@/lib/llm/provider')
const { extractClaims, extractJson, ExtractionError } = await import('@/lib/llm/extract')
const { ProviderError } = await import('@/lib/llm/errors')
const { extractionSystemPrompt, extractionUserPrompt } = await import('@/lib/llm/prompt')
const { coreOntology, parseExtraction } = await import('@/lib/ontology/extraction')
const world = await import('@/lib/ontology/seed-world')
const kaldia = await import('@/lib/ontology/seed-kaldia')
const runar = await import('@/lib/ontology/seed-runar')

/** Every hand-seeded document — the same list `check-seed-quotes.ts` keeps. */
const SEEDS: Record<string, { name: string; driveFileId: string }> = {
  world: world.SEED_DOCUMENT,
  kaldia: kaldia.SEED_DOCUMENT_KALDIA,
  runar: runar.SEED_DOCUMENT_RUNAR,
}

const unknown = wanted.filter((name) => !(name in SEEDS))
if (unknown.length > 0) throw new Error(`unknown seed(s): ${unknown.join(', ')} — known: ${Object.keys(SEEDS).join(', ')}`)

const outDir = join('scoring', 'captures', label)
const seeds = wanted.length > 0 ? wanted : Object.keys(SEEDS)
for (const name of seeds) {
  if (existsSync(join(outDir, `${name}.json`))) throw new Error(`${outDir}/${name}.json already exists — pick a new run label.`)
}
mkdirSync(outDir, { recursive: true })

const [user] = await db.select({ id: users.id }).from(users).limit(1)
if (!user) throw new Error('No users.')
const offline = Boolean(promptDir || replyDir)
const configured = offline ? null : await getProviderCredentials(user.id)
if (!offline && !configured) throw new Error('No provider configured.')
const creds = configured ?? { modelId: replyModel ?? '(prompts only)', baseUrl: 'offline' }
const client = await DriveClient.forUser(user.id)
const ontology = coreOntology()
const systemPrompt = extractionSystemPrompt(ontology)
const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16)

console.error(`run      : ${label}  (${creds.modelId} @ ${creds.baseUrl})`)

for (const name of seeds) {
  const seed = SEEDS[name]!
  const [doc] = await db
    .select({ driveVersion: documents.driveVersion })
    .from(documents)
    .where(eq(documents.driveFileId, seed.driveFileId))
  const text = await readDocumentText(client, seed.driveFileId)

  if (promptDir) {
    mkdirSync(promptDir, { recursive: true })
    writeFileSync(join(promptDir, `${name}.system.txt`), systemPrompt)
    writeFileSync(join(promptDir, `${name}.user.txt`), extractionUserPrompt(seed.name, text.paragraphs))
    console.error(`${name.padEnd(8)} : prompts written (${text.paragraphs.length} paragraphs)`)
    continue
  }

  const started = Date.now()
  try {
    const run = replyDir
      ? runFromReply(readFileSync(join(replyDir, `${name}.reply.txt`), 'utf8'))
      : await extractClaims(configured!, { documentName: seed.name, paragraphs: text.paragraphs, ontology })
    const seconds = (Date.now() - started) / 1000
    const fixture = {
      seed: name,
      document: seed,
      capturedAt: new Date().toISOString(),
      modelRequested: creds.modelId,
      baseUrl: creds.baseUrl,
      systemPromptSha: sha(systemPrompt),
      userPromptSha: sha(extractionUserPrompt(seed.name, text.paragraphs)),
      driveVersion: doc?.driveVersion ?? null,
      headRevisionId: text.headRevisionId,
      seconds,
      paragraphs: text.paragraphs,
      run,
    }
    writeFileSync(join(outDir, `${name}.json`), JSON.stringify(fixture, null, 2) + '\n')
    console.error(
      `${name.padEnd(8)} : ${run.claims.length} claims, ${run.rejections.length} rejected, ` +
        `${run.attempts} attempt(s), ${seconds.toFixed(1)}s, format "${run.responseFormat ?? 'text'}", model "${run.model}"`,
    )
  } catch (err) {
    if (err instanceof ExtractionError) {
      // A bad reply is a result worth keeping, not a reason to stop the run.
      writeFileSync(
        join(outDir, `${name}.failed.json`),
        JSON.stringify({ seed: name, code: err.code, message: err.message, raw: err.raw ?? null }, null, 2) + '\n',
      )
      console.error(`${name.padEnd(8)} : FAILED (${err.code}): ${err.message}`)
      continue
    }
    if (err instanceof ProviderError) {
      console.error(`${name.padEnd(8)} : PROVIDER (${err.reason}): ${err.detail} — stopping.`)
      process.exit(1)
    }
    throw err
  }
}

process.exit(0)

/** A saved reply, taken through the path `extractClaims` takes a live one. */
function runFromReply(reply: string) {
  const payload = extractJson(reply)
  if (payload === undefined) throw new ExtractionError('unusable_response', 'The saved reply is not JSON.', reply)
  const parsed = parseExtraction(payload, ontology)
  return {
    claims: parsed.claims,
    rejections: parsed.rejections,
    model: replyModel!,
    attempts: 1,
    responseFormat: null,
    usage: { promptTokens: 0, completionTokens: 0 },
  }
}
