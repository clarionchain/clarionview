import { NextResponse } from "next/server"
import { createInvoice, isLightningConfigured } from "@/lib/lightning"
import { CREDITS_PER_PACKAGE, CREDIT_PRICE_SATS } from "@/lib/anon-credits"

export async function POST() {
  if (!isLightningConfigured()) {
    return NextResponse.json({ error: "Lightning payments not configured" }, { status: 503 })
  }

  const invoice = await createInvoice(
    CREDIT_PRICE_SATS,
    `ClarionView ${CREDITS_PER_PACKAGE} AI credits`
  )

  if (!invoice) {
    return NextResponse.json({ error: "Failed to create invoice" }, { status: 503 })
  }

  return NextResponse.json({
    payment_request: invoice.payment_request,
    checking_id:     invoice.checking_id,
    amount_sats:     CREDIT_PRICE_SATS,
    credits:         CREDITS_PER_PACKAGE,
  })
}
