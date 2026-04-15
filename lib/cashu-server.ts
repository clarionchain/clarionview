/**
 * Server-side Cashu ecash redemption.
 * Accepts a Cashu token, verifies proofs are unspent at the mint,
 * swaps them (marks spent), and returns the redeemed sat amount.
 *
 * Configure via CASHU_MINT_URL environment variable.
 * Example: CASHU_MINT_URL=https://mint.minibits.cash/Bitcoin
 */
import { CashuMint, CashuWallet, getDecodedToken } from "@cashu/cashu-ts"
import { getDb } from "@/lib/db"

export const CASHU_MINT_URL     = process.env.CASHU_MINT_URL?.trim()
export const CASHU_MIN_VALUE_SAT = parseInt(process.env.CASHU_MIN_VALUE_SAT || "500")

export function isCashuConfigured(): boolean {
  return Boolean(CASHU_MINT_URL)
}

export async function redeemCashuToken(
  tokenStr: string
): Promise<{ ok: true; amountSat: number } | { ok: false; error: string }> {
  if (!CASHU_MINT_URL) return { ok: false, error: "Cashu not configured on this server" }

  // Decode the token
  let decoded: ReturnType<typeof getDecodedToken>
  try {
    decoded = getDecodedToken(tokenStr)
  } catch {
    return { ok: false, error: "Invalid Cashu token format" }
  }

  // Verify it's from our configured mint
  const tokenMint: string = (decoded as { mint?: string }).mint
    ?? ((decoded as { token?: { mint: string }[] }).token?.[0]?.mint ?? "")
  if (tokenMint !== CASHU_MINT_URL) {
    return { ok: false, error: `Token must be from mint: ${CASHU_MINT_URL}` }
  }

  // Extract proofs — handle both v3 and v4 token formats
  type Proof = { secret: string; amount: number; C: string; id: string }
  const proofs: Proof[] = (decoded as { proofs?: Proof[] }).proofs
    ?? ((decoded as { token?: { proofs: Proof[] }[] }).token?.[0]?.proofs ?? [])

  if (proofs.length === 0) return { ok: false, error: "Token contains no proofs" }

  const totalAmount = proofs.reduce((sum, p) => sum + p.amount, 0)
  if (totalAmount < CASHU_MIN_VALUE_SAT) {
    return { ok: false, error: `Minimum token value is ${CASHU_MIN_VALUE_SAT} sats` }
  }

  // Check for double-spend using first proof secret
  const db = getDb()
  const alreadySpent = db
    .prepare("SELECT 1 FROM spent_cashu_proofs WHERE proof_secret = ? LIMIT 1")
    .get(proofs[0].secret)
  if (alreadySpent) return { ok: false, error: "Token already redeemed" }

  // Swap proofs at the mint (atomically marks them spent)
  try {
    const mint   = new CashuMint(CASHU_MINT_URL)
    const wallet = new CashuWallet(mint)
    const { keep } = await wallet.swap(totalAmount, proofs)

    // Persist: mark input proofs spent, store output proofs
    db.transaction(() => {
      for (const proof of proofs) {
        db.prepare("INSERT OR IGNORE INTO spent_cashu_proofs (proof_secret) VALUES (?)")
          .run(proof.secret)
      }
      db.prepare("INSERT INTO cashu_proofs (proof_json, mint_url) VALUES (?, ?)")
        .run(JSON.stringify(keep), CASHU_MINT_URL)
    })()

    return { ok: true, amountSat: totalAmount }
  } catch (e) {
    return {
      ok: false,
      error: `Mint rejected token: ${e instanceof Error ? e.message : "unknown error"}`,
    }
  }
}
