/**
 * Anonymous credit tokens — issued after payment, no account required.
 * Each token is a signed JWT { sub: "anon_credit", jti: uuid, credits: N, exp }.
 * Usage is tracked in anon_credits table; one DB row per token.
 */
import { SignJWT, jwtVerify } from "jose"
import { getDb } from "@/lib/db"
import { getSessionSecretBytes } from "@/lib/auth-session"
import crypto from "crypto"

export const CREDITS_PER_PACKAGE = parseInt(process.env.CREDIT_PACKAGE_SIZE || "50")
export const CREDIT_PRICE_SATS   = parseInt(process.env.CREDIT_PRICE_SATS   || "1000")
export const CREDIT_EXPIRY_HOURS = parseInt(process.env.CREDIT_EXPIRY_HOURS || "168") // 7 days

export async function issueCreditToken(credits: number, paymentMethod: string): Promise<string> {
  const tokenId   = crypto.randomUUID()
  const expiresAt = Math.floor(Date.now() / 1000) + CREDIT_EXPIRY_HOURS * 3600

  getDb()
    .prepare("INSERT INTO anon_credits (token_id, credits_total, expires_at, payment_method) VALUES (?, ?, ?, ?)")
    .run(tokenId, credits, expiresAt, paymentMethod)

  return new SignJWT({ sub: "anon_credit", credits })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(tokenId)
    .setExpirationTime(expiresAt)
    .sign(getSessionSecretBytes())
}

export async function consumeCredit(
  tokenStr: string
): Promise<{ ok: true; remaining: number } | { ok: false; error: string }> {
  try {
    const { payload } = await jwtVerify(tokenStr, getSessionSecretBytes())
    if (payload.sub !== "anon_credit" || !payload.jti) {
      return { ok: false, error: "Invalid credit token" }
    }
    const tokenId     = payload.jti
    const creditsTotal = payload.credits as number

    const db  = getDb()
    const row = db
      .prepare("SELECT credits_used FROM anon_credits WHERE token_id = ?")
      .get(tokenId) as { credits_used: number } | undefined

    if (!row)                        return { ok: false, error: "Credit token not found"    }
    if (row.credits_used >= creditsTotal) return { ok: false, error: "No credits remaining" }

    const res = db
      .prepare("UPDATE anon_credits SET credits_used = credits_used + 1 WHERE token_id = ? AND credits_used < ?")
      .run(tokenId, creditsTotal)

    if (res.changes === 0) return { ok: false, error: "No credits remaining" }

    return { ok: true, remaining: creditsTotal - row.credits_used - 1 }
  } catch {
    return { ok: false, error: "Invalid or expired credit token" }
  }
}

export async function creditBalance(
  tokenStr: string
): Promise<{ ok: true; remaining: number; total: number } | { ok: false; error: string }> {
  try {
    const { payload } = await jwtVerify(tokenStr, getSessionSecretBytes())
    if (payload.sub !== "anon_credit" || !payload.jti) return { ok: false, error: "Invalid" }

    const row = getDb()
      .prepare("SELECT credits_total, credits_used FROM anon_credits WHERE token_id = ?")
      .get(payload.jti) as { credits_total: number; credits_used: number } | undefined

    if (!row) return { ok: false, error: "Token not found" }
    return { ok: true, remaining: row.credits_total - row.credits_used, total: row.credits_total }
  } catch {
    return { ok: false, error: "Invalid or expired token" }
  }
}
