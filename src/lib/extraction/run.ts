import 'server-only'
import { db } from '@/db'
import { readDocumentText } from '@/lib/documents/text'
import { DriveClient } from '@/lib/drive/client'
import { extractClaims } from '@/lib/llm/extract'
import { getProviderCredentials, recordHealth } from '@/lib/llm/provider'
import { coreOntology } from '@/lib/ontology/extraction'
import { writeExtraction } from '@/lib/ontology/extraction-write'
import { createRunner, type RunnerDeps } from './pipeline'

/**
 * `runExtraction(userId, documentId)` with the real collaborators: the Neon
 * database, the user's Drive grant, and the user's own provider. See
 * `pipeline.ts` for what a run does and records; this module only wires it.
 *
 * `runnerDeps` is exported for `scripts/extract-document.ts`, which swaps in a
 * model override and a tap on the reply without forking the pipeline.
 *
 * The vocabulary is the registry's, compiled in-process, rather than read back
 * out of the database. It is global and seeded from the same registry
 * (ADR §15), so the two are the same thing — and the catalog's foreign keys,
 * not this choice, are what a drifted seed would collide with.
 */
export const runnerDeps: RunnerDeps = {
  db,
  credentials: getProviderCredentials,
  readText: async (userId, driveFileId) =>
    readDocumentText(await DriveClient.forUser(userId), driveFileId),
  extract: extractClaims,
  write: writeExtraction,
  ontology: coreOntology,
  recordHealth,
}

export const runExtraction = createRunner(runnerDeps)

export type { RunOutcome } from './pipeline'
