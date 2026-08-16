import 'server-only'
import { z } from 'zod'

/**
 * Server-side environment. Validated once at import time so a misconfigured
 * deploy fails loudly at boot rather than at the first OAuth callback.
 *
 * Nothing here may ever be exposed to the browser. There are deliberately no
 * NEXT_PUBLIC_* vars in this file.
 */

const base64Key32 = z
  .string()
  .min(1)
  .refine(
    (v) => {
      try {
        return Buffer.from(v, 'base64').length === 32
      } catch {
        return false
      }
    },
    { message: 'must be base64 decoding to exactly 32 bytes (openssl rand -base64 32)' },
  )

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_URL_UNPOOLED: z.string().min(1).optional(),

  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),

  APP_URL: z
    .url()
    .refine((v) => !v.endsWith('/'), { message: 'must not have a trailing slash' }),

  SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),

  TOKEN_ENC_ACTIVE: z
    .string()
    .regex(/^[a-z0-9]+$/, 'must be lowercase alphanumeric, e.g. "v1"'),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // --- Feature flags (see src/lib/flags.ts) ---
  SHOW_DOCUMENT_IDS: z
    .enum(['0', '1', 'true', 'false'])
    .default('0')
    .transform((v) => v === '1' || v === 'true'),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n')
  throw new Error(`Invalid environment configuration:\n${issues}\n\nSee .env.example.`)
}

/**
 * Every TOKEN_ENC_KEY_<ID> in the environment, keyed by lowercased <ID>.
 *
 * More than one may be present: rotation works by adding a new key and flipping
 * TOKEN_ENC_ACTIVE, leaving the old key in place so existing envelopes keep
 * decrypting until the population has drained. See secretbox.ts.
 */
function readKeyring(): Map<string, Buffer> {
  const ring = new Map<string, Buffer>()

  for (const [name, value] of Object.entries(process.env)) {
    const match = /^TOKEN_ENC_KEY_([A-Za-z0-9]+)$/.exec(name)
    if (!match || !value) continue

    const keyId = match[1]!.toLowerCase()
    const check = base64Key32.safeParse(value)
    if (!check.success) {
      throw new Error(`Invalid environment configuration:\n  ${name}: ${check.error.issues[0]?.message}`)
    }
    ring.set(keyId, Buffer.from(value, 'base64'))
  }

  if (ring.size === 0) {
    throw new Error(
      'Invalid environment configuration:\n  TOKEN_ENC_KEY_V1: at least one token encryption key is required.\n\nGenerate one with: openssl rand -base64 32',
    )
  }

  return ring
}

const tokenEncKeyring = readKeyring()
const tokenEncActive = parsed.data.TOKEN_ENC_ACTIVE.toLowerCase()

if (!tokenEncKeyring.has(tokenEncActive)) {
  throw new Error(
    `Invalid environment configuration:\n  TOKEN_ENC_ACTIVE is "${tokenEncActive}" but TOKEN_ENC_KEY_${tokenEncActive.toUpperCase()} is not set.`,
  )
}

export const env = {
  ...parsed.data,
  tokenEncKeyring,
  tokenEncActive,

  /**
   * Derived, never taken from a request header. Injecting a Host header into an
   * OAuth redirect_uri is a real attack, and this is the one place it could enter.
   */
  googleRedirectUri: `${parsed.data.APP_URL}/api/auth/google/callback`,

  isProduction: parsed.data.NODE_ENV === 'production',
} as const
