import { NextResponse } from "next/server"
import { redeemCashuToken, isCashuConfigured, CASHU_MINT_URL, CASHU_MIN_VALUE_SAT } from "@/lib/cashu-server"
import { issueCreditToken, CREDITS_PER_PACKAGE, CREDIT_PRICE_SATS } from "@/lib/anon-credits"

export async function GET() {
  return NextResponse.json({
    configured: isCashuConfigured(),
    mint_url:   isCashuConfigured() ? CASHU_MINT_URL : null,
    min_sats:   CASHU_MIN_VALUE_SAT,
    sats_per_package: CREDIT_PRICE_SATS,
    credits_per_package: CREDITS_PER_PACKAGE,
  })
}

export async function POST(req: Request) {
  if (!isCashuConfigured()) {
    return NextResponse.json({ error: "Cashu payments not configured" }, { status: 503 })
  }

  let body: { token?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (typeof body.token !== "string" || !body.token.trim()) {
    return NextResponse.json({ error: "token is required" }, { status: 400 })
  }

  const result = await redeemCashuToken(body.token.trim())
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  // Scale credits proportionally to amount paid
  const credits = Math.floor((result.amountSat / CREDIT_PRICE_SATS) * CREDITS_PER_PACKAGE)
  const finalCredits = Math.max(credits, Math.floor(CREDITS_PER_PACKAGE / 2)) // minimum half-package

  const token = await issueCreditToken(finalCredits, "cashu")
  return NextResponse.json({ ok: true, token, credits: finalCredits, redeemed_sats: result.amountSat })
}
