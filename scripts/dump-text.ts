/**
 * Read-only: export cleaned text for a set of documents to files, print stats.
 * Throwaway helper for choosing ground-truth documents. No LLM, no writes.
 *
 *   npx tsx --conditions=react-server --tsconfig tsconfig.json scripts/dump-text.ts <outDir> "name a" "name b" ...
 */
import { config as loadEnv } from 'dotenv'

loadEnv({ path: ['.env.local', '.env'], quiet: true })

const argv = process.argv.slice(2)
const outDir = argv[0]!
const queries = argv.slice(1)

const { and, eq, ilike, isNull } = await import('drizzle-orm')
const { db } = await import('@/db')
const { documents, users } = await import('@/db/schema')
const { DriveClient } = await import('@/lib/drive/client')
const { readDocumentText } = await import('@/lib/documents/text')
const { estimateTokens } = await import('@/lib/documents/text')
const fs = await import('node:fs/promises')

const [user] = await db.select({ id: users.id }).from(users).limit(2)
if (!user) throw new Error('No users.')
const client = await DriveClient.forUser(user.id)

await fs.mkdir(outDir, { recursive: true })

for (const q of queries) {
  const matches = await db
    .select({ id: documents.id, name: documents.name, driveFileId: documents.driveFileId })
    .from(documents)
    .where(and(eq(documents.userId, user.id), isNull(documents.removedAt), ilike(documents.name, `%${q}%`)))
  if (matches.length !== 1) {
    console.log(`SKIP "${q}": ${matches.length} matches (${matches.map((m) => m.name).join(', ')})`)
    continue
  }
  const doc = matches[0]!
  try {
    const text = await readDocumentText(client, doc.driveFileId)
    const slug = doc.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
    await fs.writeFile(`${outDir}/${slug}.md`, `# ${doc.name}\n\n${text.markdown}`)
    console.log(
      `${String(text.paragraphs.length).padStart(3)} ¶  ` +
        `${String(text.markdown.length).padStart(6)} chars  ` +
        `~${String(estimateTokens(text.markdown)).padStart(5)} tok  ${doc.name}`,
    )
  } catch (err) {
    console.log(`ERR  "${doc.name}": ${(err as Error).message}`)
  }
}
