/**
 * LNbits API wrapper for creating and checking Lightning invoices.
 * Configure via LNBITS_URL and LNBITS_INVOICE_KEY environment variables.
 *
 * Compatible with any LNbits instance (self-hosted or cloud).
 * For self-hosted: https://docs.lnbits.org
 */

const LNBITS_URL         = process.env.LNBITS_URL?.trim().replace(/\/$/, "")
const LNBITS_INVOICE_KEY = process.env.LNBITS_INVOICE_KEY?.trim()

export function isLightningConfigured(): boolean {
  return Boolean(LNBITS_URL && LNBITS_INVOICE_KEY)
}

export interface LightningInvoice {
  payment_request: string
  checking_id: string
  amount_sats: number
}

export async function createInvoice(amountSats: number, memo: string): Promise<LightningInvoice | null> {
  if (!LNBITS_URL || !LNBITS_INVOICE_KEY) return null
  try {
    const res = await fetch(`${LNBITS_URL}/api/v1/payments`, {
      method: "POST",
      headers: {
        "X-Api-Key": LNBITS_INVOICE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ out: false, amount: amountSats, memo }),
    })
    if (!res.ok) return null
    const data = await res.json() as { payment_request: string; checking_id: string }
    return { payment_request: data.payment_request, checking_id: data.checking_id, amount_sats: amountSats }
  } catch {
    return null
  }
}

export async function checkInvoicePaid(checkingId: string): Promise<boolean> {
  if (!LNBITS_URL || !LNBITS_INVOICE_KEY) return false
  try {
    const res = await fetch(`${LNBITS_URL}/api/v1/payments/${checkingId}`, {
      headers: { "X-Api-Key": LNBITS_INVOICE_KEY },
    })
    if (!res.ok) return false
    const data = await res.json() as { paid: boolean }
    return data.paid === true
  } catch {
    return false
  }
}
