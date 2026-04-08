import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto"

const ALGO = "aes-256-gcm"
const IV_LEN = 12
const TAG_LEN = 16
const DEV_SALT = "workbench-byok-v1"

let devFallbackWarned = false

function getEncryptionKeyBytes(): Buffer {
  const hex = process.env.WORKBENCH_BYOK_ENCRYPTION_KEY?.trim()
  if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) {
    return Buffer.from(hex, "hex")
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "WORKBENCH_BYOK_ENCRYPTION_KEY must be set to 64 hex characters (32 bytes) before storing BYOK keys in production."
    )
  }
  if (!devFallbackWarned) {
    devFallbackWarned = true
    console.warn(
      "[workbench] WORKBENCH_BYOK_ENCRYPTION_KEY unset; deriving BYOK encryption key from WORKBENCH_SESSION_SECRET (development only)."
    )
  }
  const secret = process.env.WORKBENCH_SESSION_SECRET || "dev-insecure-workbench-secret-min-32-chars!!"
  return scryptSync(secret, DEV_SALT, 32)
}

/** Encrypt OpenRouter API key for SQLite storage. */
export function encryptByok(plaintext: string): string {
  const key = getEncryptionKeyBytes()
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, key, iv)
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString("base64")
}

export function decryptByok(blob: string): string | null {
  try {
    const buf = Buffer.from(blob, "base64")
    if (buf.length < IV_LEN + TAG_LEN + 1) return null
    const iv = buf.subarray(0, IV_LEN)
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN)
    const enc = buf.subarray(IV_LEN + TAG_LEN)
    const key = getEncryptionKeyBytes()
    const decipher = createDecipheriv(ALGO, key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8")
  } catch {
    return null
  }
}
