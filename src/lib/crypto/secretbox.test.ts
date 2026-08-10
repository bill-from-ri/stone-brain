import { beforeAll, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'

// env.ts validates at import time, so the environment has to exist before the
// module graph is pulled in. Two keys, so rotation can actually be exercised.
const KEY_V1 = randomBytes(32).toString('base64')
const KEY_V2 = randomBytes(32).toString('base64')

process.env.DATABASE_URL = 'postgresql://u:p@localhost/db'
process.env.GOOGLE_CLIENT_ID = 'test-client-id'
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret'
process.env.APP_URL = 'http://localhost:3000'
process.env.SESSION_SECRET = randomBytes(32).toString('base64')
process.env.TOKEN_ENC_KEY_V1 = KEY_V1
process.env.TOKEN_ENC_KEY_V2 = KEY_V2
process.env.TOKEN_ENC_ACTIVE = 'v1'

type Secretbox = typeof import('./secretbox')
let box: Secretbox

const USER = '11111111-1111-4111-8111-111111111111'
const OTHER_USER = '22222222-2222-4222-8222-222222222222'
const TOKEN = '1//0gFakeRefreshTokenValue-abcdefghijklmnop'

beforeAll(async () => {
  box = await import('./secretbox')
})

describe('secretbox', () => {
  it('round-trips a secret', () => {
    const envelope = box.encrypt(TOKEN, USER, 'google_refresh_token')
    expect(box.decrypt(envelope, USER, 'google_refresh_token')).toBe(TOKEN)
  })

  it('produces the documented envelope shape', () => {
    const envelope = box.encrypt(TOKEN, USER, 'google_refresh_token')
    const parts = envelope.split('.')
    expect(parts).toHaveLength(5)
    expect(parts[0]).toBe('v1')
    expect(parts[1]).toBe('v1') // active keyId
    expect(Buffer.from(parts[2]!, 'base64url')).toHaveLength(12) // iv
    expect(Buffer.from(parts[3]!, 'base64url')).toHaveLength(16) // tag
  })

  it('never emits the plaintext inside the envelope', () => {
    const envelope = box.encrypt(TOKEN, USER, 'google_refresh_token')
    expect(envelope).not.toContain(TOKEN)
  })

  it('encrypts the same plaintext to different ciphertexts (IV randomness)', () => {
    const a = box.encrypt(TOKEN, USER, 'google_refresh_token')
    const b = box.encrypt(TOKEN, USER, 'google_refresh_token')
    expect(a).not.toBe(b)
    expect(box.decrypt(a, USER, 'google_refresh_token')).toBe(TOKEN)
    expect(box.decrypt(b, USER, 'google_refresh_token')).toBe(TOKEN)
  })

  it('rejects a tampered ciphertext', () => {
    const parts = box.encrypt(TOKEN, USER, 'google_refresh_token').split('.')
    const ct = Buffer.from(parts[4]!, 'base64url')
    ct[0] = ct[0]! ^ 0xff
    parts[4] = ct.toString('base64url')
    expect(() => box.decrypt(parts.join('.'), USER, 'google_refresh_token')).toThrow(
      box.SecretDecryptError,
    )
  })

  it('rejects a tampered auth tag', () => {
    const parts = box.encrypt(TOKEN, USER, 'google_refresh_token').split('.')
    const tag = Buffer.from(parts[3]!, 'base64url')
    tag[0] = tag[0]! ^ 0xff
    parts[3] = tag.toString('base64url')
    expect(() => box.decrypt(parts.join('.'), USER, 'google_refresh_token')).toThrow(
      box.SecretDecryptError,
    )
  })

  // The two AAD tests are the point of binding userId and purpose into the
  // envelope: a stolen or misfiled ciphertext must not decrypt.
  it("rejects another user's envelope", () => {
    const envelope = box.encrypt(TOKEN, USER, 'google_refresh_token')
    expect(() => box.decrypt(envelope, OTHER_USER, 'google_refresh_token')).toThrow(
      box.SecretDecryptError,
    )
  })

  it('rejects an envelope decrypted under the wrong purpose', () => {
    const envelope = box.encrypt(TOKEN, USER, 'google_refresh_token')
    expect(() => box.decrypt(envelope, USER, 'google_access_token')).toThrow(
      box.SecretDecryptError,
    )
  })

  it('rejects an unknown keyId', () => {
    const parts = box.encrypt(TOKEN, USER, 'google_refresh_token').split('.')
    parts[1] = 'v99'
    expect(() => box.decrypt(parts.join('.'), USER, 'google_refresh_token')).toThrow(
      /No encryption key for keyId "v99"/,
    )
  })

  it('rejects a malformed envelope', () => {
    expect(() => box.decrypt('not-an-envelope', USER, 'google_refresh_token')).toThrow(
      /Malformed envelope/,
    )
    expect(() => box.decrypt('v2.v1.a.b.c', USER, 'google_refresh_token')).toThrow(
      /Unsupported envelope format/,
    )
  })

  it('flags envelopes written under a non-active key for rewrap', () => {
    const current = box.encrypt(TOKEN, USER, 'google_refresh_token')
    expect(box.needsRewrap(current)).toBe(false)

    // Simulate an envelope left over from before a rotation.
    const stale = ['v1', 'v2', ...current.split('.').slice(2)].join('.')
    expect(box.needsRewrap(stale)).toBe(true)
  })

  it('redacts secrets to a last-four hint', () => {
    expect(box.redact(TOKEN)).toBe('****mnop')
    expect(box.redact('abc')).toBe('****')
  })

  it('compares tokens without leaking length mismatches as throws', () => {
    expect(box.safeEqual('abc123', 'abc123')).toBe(true)
    expect(box.safeEqual('abc123', 'abc124')).toBe(false)
    expect(box.safeEqual('abc', 'abcdef')).toBe(false)
  })
})
