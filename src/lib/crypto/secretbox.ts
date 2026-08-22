import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto'
import { env } from '@/lib/env'

/**
 * The only module in the codebase that touches ciphertext, and the only thing
 * that should ever import the *_enc columns.
 *
 * Envelope format — one self-describing text column, no separate iv/tag columns:
 *
 *     v1.<keyId>.<iv_b64url>.<tag_b64url>.<ciphertext_b64url>
 *
 * The keyId is embedded so decryption never has to guess which key was used.
 * That is the whole reason rotation is possible: add TOKEN_ENC_KEY_V2, flip
 * TOKEN_ENC_ACTIVE to v2, and v1 envelopes keep decrypting until they drain.
 */

const FORMAT = 'v1'
const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const TAG_BYTES = 16

/** What a secret is for. Bound into the AAD so envelopes cannot be swapped between columns. */
export type SecretPurpose = 'google_refresh_token' | 'google_access_token' | 'llm_api_key'

export class SecretDecryptError extends Error {
  override readonly name = 'SecretDecryptError'
  constructor(message: string) {
    // Deliberately never includes the envelope or any plaintext — this message
    // reaches logs.
    super(message)
  }
}

/**
 * Additional authenticated data. Binding the user and the purpose means a
 * ciphertext copied from another user's row, or from the access-token column
 * into the refresh-token column, fails authentication rather than decrypting
 * into something usable. Turns a whole class of mistake into a loud error.
 */
function aad(userId: string, purpose: SecretPurpose): Buffer {
  return Buffer.from(`${userId}:${purpose}`, 'utf8')
}

function keyFor(keyId: string): Buffer {
  const key = env.tokenEncKeyring.get(keyId)
  if (!key) {
    throw new SecretDecryptError(
      `No encryption key for keyId "${keyId}". Is TOKEN_ENC_KEY_${keyId.toUpperCase()} still set?`,
    )
  }
  return key
}

export function encrypt(plaintext: string, userId: string, purpose: SecretPurpose): string {
  const keyId = env.tokenEncActive
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, keyFor(keyId), iv, { authTagLength: TAG_BYTES })
  cipher.setAAD(aad(userId, purpose))

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return [
    FORMAT,
    keyId,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

export function decrypt(envelope: string, userId: string, purpose: SecretPurpose): string {
  const parts = envelope.split('.')
  if (parts.length !== 5) {
    throw new SecretDecryptError(`Malformed envelope: expected 5 segments, got ${parts.length}`)
  }

  const [format, keyId, ivB64, tagB64, ciphertextB64] = parts as [
    string,
    string,
    string,
    string,
    string,
  ]

  if (format !== FORMAT) {
    throw new SecretDecryptError(`Unsupported envelope format "${format}"`)
  }

  const iv = Buffer.from(ivB64, 'base64url')
  const tag = Buffer.from(tagB64, 'base64url')
  if (iv.length !== IV_BYTES) throw new SecretDecryptError('Malformed envelope: bad IV length')
  if (tag.length !== TAG_BYTES) throw new SecretDecryptError('Malformed envelope: bad auth tag length')

  const decipher = createDecipheriv(ALGORITHM, keyFor(keyId), iv, { authTagLength: TAG_BYTES })
  decipher.setAAD(aad(userId, purpose))
  decipher.setAuthTag(tag)

  try {
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextB64, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    // GCM authentication failed: tampered ciphertext, tampered tag, wrong key,
    // or wrong AAD. We deliberately do not distinguish — the caller cannot act
    // differently on any of them, and saying which would be an oracle.
    throw new SecretDecryptError('Secret failed authentication and could not be decrypted')
  }
}

/**
 * True when an envelope was written under a key other than the active one, so
 * callers can opportunistically re-encrypt during a write they were doing anyway.
 * That is what drains the population during a key rotation.
 */
export function needsRewrap(envelope: string): boolean {
  const keyId = envelope.split('.')[1]
  return keyId !== undefined && keyId !== env.tokenEncActive
}

/**
 * For the rare debugging need. Never log a decrypted secret; log this instead.
 */
export function redact(secret: string): string {
  if (secret.length <= 4) return '****'
  return `****${secret.slice(-4)}`
}

/** Constant-time compare for opaque tokens (session tokens, OAuth state). */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
