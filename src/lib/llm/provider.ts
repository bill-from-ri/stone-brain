import 'server-only'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { providerSettings, type ProviderHealth } from '@/db/schema'
import { decrypt, encrypt, needsRewrap } from '@/lib/crypto/secretbox'
import { normalizeBaseUrl, probe, type ProviderCredentials } from './client'
import { ProviderError } from './errors'

/**
 * The single entry point for the user's inference provider. Nothing else in the
 * codebase reads `provider_settings` — the same rule src/lib/google/tokens.ts
 * holds for `google_accounts`, and for the same reason: exactly one module
 * should be able to produce a plaintext secret.
 *
 * The read split is deliberate and load-bearing:
 *
 *   getProviderStatus()      — safe to hand to a client component. No key.
 *   getProviderCredentials() — server-only, decrypts, for making a call.
 *
 * Having two functions rather than one with a flag means a component that wants
 * to show the connection state cannot obtain the key by passing the wrong
 * argument. There is no read path that returns the plaintext to a caller who
 * asked for display data.
 */

/** What the browser is allowed to know about the configured provider. */
export type ProviderStatus = {
  baseUrl: string
  modelId: string
  /** The last four characters of the key, so a person can tell which one is on file. */
  keyLast4: string
  health: ProviderHealth
  healthDetail: string | null
  healthCheckedAt: string | null
}

export async function getProviderStatus(userId: string): Promise<ProviderStatus | null> {
  const rows = await db
    .select({
      baseUrl: providerSettings.baseUrl,
      modelId: providerSettings.modelId,
      keyLast4: providerSettings.apiKeyLast4,
      health: providerSettings.health,
      healthDetail: providerSettings.healthDetail,
      healthCheckedAt: providerSettings.healthCheckedAt,
    })
    .from(providerSettings)
    .where(eq(providerSettings.userId, userId))
    .limit(1)

  const row = rows[0]
  if (!row) return null

  return {
    ...row,
    // Serialised here rather than at the boundary: a Date crossing into a
    // client component is a needless serialisation question, and the only
    // consumer wants to format it anyway.
    healthCheckedAt: row.healthCheckedAt?.toISOString() ?? null,
  }
}

/**
 * Decrypted credentials for making an actual call. Null when the user has not
 * configured a provider — the "missing key" state from decisions §11, which is
 * an absence rather than a failure, so callers branch on it rather than catch it.
 */
export async function getProviderCredentials(userId: string): Promise<ProviderCredentials | null> {
  const rows = await db
    .select({
      baseUrl: providerSettings.baseUrl,
      modelId: providerSettings.modelId,
      apiKeyEnc: providerSettings.apiKeyEnc,
    })
    .from(providerSettings)
    .where(eq(providerSettings.userId, userId))
    .limit(1)

  const row = rows[0]
  if (!row) return null

  return {
    baseUrl: row.baseUrl,
    modelId: row.modelId,
    apiKey: decrypt(row.apiKeyEnc, userId, 'llm_api_key'),
  }
}

/** Record the verdict of a call that already happened, without re-probing. */
export async function recordHealth(
  userId: string,
  health: ProviderHealth,
  detail: string | null,
): Promise<void> {
  await db
    .update(providerSettings)
    .set({ health, healthDetail: detail, healthCheckedAt: new Date(), updatedAt: new Date() })
    .where(eq(providerSettings.userId, userId))
}

export type SaveProviderInput = {
  baseUrl: string
  modelId: string
  /**
   * Omitted to keep the key already on file — which is what makes "change the
   * model, leave the key alone" possible. Since the key is never sent to the
   * browser, the form has nothing to send back for an unchanged one; an
   * omission is the only honest way to express that.
   */
  apiKey?: string
}

export type SaveProviderResult =
  | { ok: true; status: ProviderStatus }
  | { ok: false; error: string }

/**
 * Store the configuration, then verify it.
 *
 * Verification is advisory, not a gate: the row is written first and stays
 * written even when the probe fails. A provider that is merely down, or rate
 * limiting, must not be able to stop someone saving a key they know is good —
 * and a key that really is mistyped is more useful stored-and-flagged than
 * discarded, because the flag says which of the three fields to go fix.
 */
export async function saveProvider(
  userId: string,
  input: SaveProviderInput,
): Promise<SaveProviderResult> {
  const baseUrl = normalizeBaseUrl(input.baseUrl)
  const modelId = input.modelId.trim()

  // Checked here as well as in the route's schema: this is the last point
  // before a URL is stored, and a stored `javascript:` or `file:` URL would be
  // a footgun aimed at whatever calls it later.
  let parsedUrl: URL
  try {
    parsedUrl = new URL(baseUrl)
  } catch {
    return { ok: false, error: 'That base URL is not a valid URL.' }
  }
  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    return { ok: false, error: 'The base URL must be http or https.' }
  }

  const existing = await db
    .select({ apiKeyEnc: providerSettings.apiKeyEnc, apiKeyLast4: providerSettings.apiKeyLast4 })
    .from(providerSettings)
    .where(eq(providerSettings.userId, userId))
    .limit(1)
    .then((r) => r[0] ?? null)

  const newKey = input.apiKey?.trim()

  if (!newKey && !existing) {
    return { ok: false, error: 'An API key is required.' }
  }

  let apiKey: string
  let apiKeyEnc: string
  let apiKeyLast4: string

  if (newKey) {
    apiKey = newKey
    apiKeyEnc = encrypt(newKey, userId, 'llm_api_key')
    apiKeyLast4 = newKey.slice(-4)
  } else {
    apiKey = decrypt(existing!.apiKeyEnc, userId, 'llm_api_key')
    // Opportunistic rewrap during a write we were doing anyway — the same
    // rotation-draining trick as google/tokens.ts.
    apiKeyEnc = needsRewrap(existing!.apiKeyEnc)
      ? encrypt(apiKey, userId, 'llm_api_key')
      : existing!.apiKeyEnc
    apiKeyLast4 = existing!.apiKeyLast4
  }

  await db
    .insert(providerSettings)
    .values({
      userId,
      baseUrl,
      modelId,
      apiKeyEnc,
      apiKeyLast4,
      health: 'unknown',
      healthDetail: null,
      healthCheckedAt: null,
    })
    .onConflictDoUpdate({
      target: providerSettings.userId,
      set: {
        baseUrl,
        modelId,
        apiKeyEnc,
        apiKeyLast4,
        health: 'unknown',
        healthDetail: null,
        healthCheckedAt: null,
        updatedAt: new Date(),
      },
    })

  const verdict = await checkProvider({ baseUrl, modelId, apiKey })
  await recordHealth(userId, verdict.health, verdict.detail)

  const status = await getProviderStatus(userId)
  if (!status) return { ok: false, error: 'The provider settings could not be saved.' }
  return { ok: true, status }
}

/** Re-run the probe against whatever is already stored. */
export async function verifyProvider(userId: string): Promise<ProviderStatus | null> {
  const creds = await getProviderCredentials(userId)
  if (!creds) return null

  const verdict = await checkProvider(creds)
  await recordHealth(userId, verdict.health, verdict.detail)
  return getProviderStatus(userId)
}

export async function deleteProvider(userId: string): Promise<void> {
  await db.delete(providerSettings).where(eq(providerSettings.userId, userId))
}

/**
 * Run the probe and flatten it into a storable verdict. Kept separate from the
 * writes above so that "what did the provider say" and "what do we record"
 * remain one function each.
 */
async function checkProvider(
  creds: ProviderCredentials,
): Promise<{ health: ProviderHealth; detail: string | null }> {
  try {
    await probe(creds)
    return { health: 'ok', detail: null }
  } catch (err) {
    if (err instanceof ProviderError) return { health: err.reason, detail: err.detail }
    // Anything else is our bug, not the provider's. Recorded as unreachable so
    // the UI has a state, with a detail that does not pretend to diagnose.
    return { health: 'unreachable', detail: 'The connection check failed unexpectedly.' }
  }
}
