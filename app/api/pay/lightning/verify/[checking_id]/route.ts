import { NextResponse } from "next/server"
import { checkInvoicePaid } from "@/lib/lightning"
import { issueCreditToken, CREDITS_PER_PACKAGE } from "@/lib/anon-credits"

export async function GET(
  _req: Request,
  { params }: { params: { checking_id: string } }
) {
  const paid = await checkInvoicePaid(params.checking_id)
  if (!paid) {
    return NextResponse.json({ paid: false })
  }

  const token = await issueCreditToken(CREDITS_PER_PACKAGE, "lightning")
  return NextResponse.json({ paid: true, token, credits: CREDITS_PER_PACKAGE })
}
