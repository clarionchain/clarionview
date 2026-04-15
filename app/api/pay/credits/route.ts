import { NextResponse } from "next/server"
import { creditBalance } from "@/lib/anon-credits"
import { isLightningConfigured } from "@/lib/lightning"
import { isCashuConfigured, CASHU_MINT_URL } from "@/lib/cashu-server"
import { CREDITS_PER_PACKAGE, CREDIT_PRICE_SATS } from "@/lib/anon-credits"

/** Check credit balance for a token, and return available payment methods. */
export async function GET(req: Request) {
  const token = req.headers.get("x-credit-token") ?? new URL(req.url).searchParams.get("token")

  const balance = token ? await creditBalance(token) : null

  return NextResponse.json({
    balance: balance?.ok ? { remaining: balance.remaining, total: balance.total } : null,
    payment_methods: {
      lightning: isLightningConfigured(),
      cashu:     isCashuConfigured(),
    },
    cashu_mint_url: isCashuConfigured() ? CASHU_MINT_URL : null,
    package: { credits: CREDITS_PER_PACKAGE, price_sats: CREDIT_PRICE_SATS },
  })
}
