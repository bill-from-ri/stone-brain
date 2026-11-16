/**
 * Read-only: check every hand-seeded claim's quote against the live document.
 *
 * A seeded quote is a citation, so it has to be a verbatim substring of the
 * paragraph it cites *as the extractor sees it today* — after `cleanExport` and
 * `toParagraphs`. This re-exports each seeded document from Drive and reports
 * every claim whose quote is not in its `[¶n]`, and which paragraph (if any) it
 * did turn up in. Run it after writing a seed, and after any change to the
 * export cleaning or paragraph splitting, which can silently move citations.
 *
 *   npx tsx --conditions=react-server --tsconfig tsconfig.json scripts/check-seed-quotes.ts [seed ...]
 *
 * With no arguments, checks every seed listed in SEEDS. No LLM, no writes.
 */
import { config as loadEnv } from 'dotenv'

loadEnv({ path: ['.env.local', '.env'], quiet: true })

const { db } = await import('@/db')
const { users } = await import('@/db/schema')
const { DriveClient } = await import('@/lib/drive/client')
const { readDocumentText } = await import('@/lib/documents/text')
// The seed data is private and gitignored (see src/lib/ontology/ground-truth.ts).
const world = await import('../corpus/seeds/world')
const kaldia = await import('../corpus/seeds/kaldia')
const runar = await import('../corpus/seeds/runar')

type Seed = {
  document: { name: string; driveFileId: string }
  claims: { subject: string; predicate: string; quote?: string; paragraph?: number }[]
}

/** Every hand-seeded document. Add a line here when a new seed module lands. */
const SEEDS: Record<string, Seed> = {
  world: { document: world.SEED_DOCUMENT, claims: world.SEED_CLAIMS },
  kaldia: { document: kaldia.SEED_DOCUMENT_KALDIA, claims: kaldia.KALDIA_CLAIMS },
  runar: { document: runar.SEED_DOCUMENT_RUNAR, claims: runar.RUNAR_CLAIMS },
}

const wanted = process.argv.slice(2)
const unknown = wanted.filter((name) => !(name in SEEDS))
if (unknown.length > 0) throw new Error(`unknown seed(s): ${unknown.join(', ')} — known: ${Object.keys(SEEDS).join(', ')}`)

const [user] = await db.select({ id: users.id }).from(users).limit(1)
if (!user) throw new Error('No users.')
const client = await DriveClient.forUser(user.id)

let failures = 0
for (const name of wanted.length > 0 ? wanted : Object.keys(SEEDS)) {
  const seed = SEEDS[name]!
  const { paragraphs } = await readDocumentText(client, seed.document.driveFileId)
  // Hand-entered claims have no document behind them, so nothing to check.
  const sourced = seed.claims.flatMap((c) =>
    c.quote !== undefined && c.paragraph !== undefined ? [{ ...c, quote: c.quote, paragraph: c.paragraph }] : [],
  )
  const bad = sourced.filter((c) => !paragraphs[c.paragraph]?.text.includes(c.quote))

  console.log(`${name}: ${sourced.length - bad.length}/${sourced.length} quotes found in their cited paragraph (${seed.document.name}, ${paragraphs.length} ¶)`)
  for (const c of bad) {
    const foundIn = paragraphs.filter((p) => p.text.includes(c.quote)).map((p) => `¶${p.index}`)
    console.log(`  ✗ ¶${c.paragraph} ${c.subject} ${c.predicate}: "${c.quote}" — ${foundIn.length > 0 ? `found in ${foundIn.join(', ')}` : 'not found anywhere'}`)
  }
  failures += bad.length
}

process.exit(failures > 0 ? 1 : 0)
