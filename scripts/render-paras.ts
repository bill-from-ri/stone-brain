/**
 * Read-only: show a document's paragraphs exactly as the model is shown them,
 * with [¶n] markers. Used by the seed-ground-truth skill to judge citability and
 * copy quotes.
 *
 *   npx tsx --conditions=react-server --tsconfig tsconfig.json scripts/render-paras.ts "<document name>"
 */
import { config as loadEnv } from 'dotenv'

loadEnv({ path: ['.env.local', '.env'], quiet: true })

const q = process.argv.slice(2).join(' ').trim()

const { and, eq, ilike, isNull } = await import('drizzle-orm')
const { db } = await import('@/db')
const { documents, users } = await import('@/db/schema')
const { DriveClient } = await import('@/lib/drive/client')
const { readDocumentText } = await import('@/lib/documents/text')
const { renderForPrompt } = await import('@/lib/drive/markdown')

const [user] = await db.select({ id: users.id }).from(users).limit(2)
if (!user) throw new Error('No users.')

const [doc] = await db
  .select({ driveFileId: documents.driveFileId, name: documents.name })
  .from(documents)
  .where(and(eq(documents.userId, user.id), isNull(documents.removedAt), ilike(documents.name, `%${q}%`)))
if (!doc) throw new Error(`No document matching "${q}".`)

const client = await DriveClient.forUser(user.id)
const text = await readDocumentText(client, doc.driveFileId)
console.log(renderForPrompt(text.paragraphs))
