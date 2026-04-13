/**
 * Magic link authentication
 *
 * POST /api/auth/magic          { email } → sends magic link email
 * GET  /api/auth/magic?token=X  → verifies token, sets session, redirects
 */

import { NextRequest, NextResponse } from "next/server"
import { createTransport } from "nodemailer"
import { SignJWT, jwtVerify } from "jose"
import { getUserByEmail } from "@/lib/db"
import { signSessionToken, setSessionCookie, getSessionSecretBytes, getSessionCookiePath } from "@/lib/auth-session"
import { withBase } from "@/lib/base-path"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function getMailer() {
  const host = process.env.SMTP_HOST
  if (!host) return null
  return createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  })
}

function getSiteUrl(): string {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "")
  const rpId = process.env.WEBAUTHN_RP_ID
  if (rpId && rpId !== "localhost") return `https://${rpId}`
  return "http://localhost:3002"
}

function getFromAddress(): string {
  return process.env.SMTP_FROM || `noreply@${process.env.WEBAUTHN_RP_ID || "clarionlab.dev"}`
}

// ---------------------------------------------------------------------------
// Token helpers — re-use the same secret but with a different "purpose" claim
// ---------------------------------------------------------------------------

const MAGIC_TTL = "10m"

async function signMagicToken(userId: number): Promise<string> {
  return new SignJWT({ sub: String(userId), purpose: "magic" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(MAGIC_TTL)
    .sign(getSessionSecretBytes())
}

async function verifyMagicToken(token: string): Promise<number | null> {
  try {
    const { payload } = await jwtVerify(token, getSessionSecretBytes())
    if (payload.purpose !== "magic" || !payload.sub) return null
    const id = parseInt(payload.sub, 10)
    return Number.isFinite(id) ? id : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// POST — request magic link
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { email?: string }
  const email = body.email?.trim()
  if (!email) return NextResponse.json({ error: "Email required" }, { status: 400 })

  const user = getUserByEmail(email)
  // Always return success to avoid user enumeration
  if (!user) {
    return NextResponse.json({ ok: true })
  }

  const token = await signMagicToken(user.id)
  const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/$/, "")
  const link = `${getSiteUrl()}${basePath}/login?token=${encodeURIComponent(token)}`

  const mailer = getMailer()
  if (mailer) {
    try {
      await mailer.sendMail({
        from: getFromAddress(),
        to: email,
        subject: "Sign in to ClarionView",
        text: `Click the link below to sign in. It expires in 10 minutes.\n\n${link}\n\nIf you didn't request this, ignore this email.`,
        html: `
          <div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:24px">
            <h2 style="margin:0 0 16px;font-size:18px">Sign in to ClarionView</h2>
            <p style="color:#555;margin:0 0 24px">Click the button below. This link expires in 10 minutes.</p>
            <a href="${link}" style="display:inline-block;background:#0ea5e9;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">Sign in</a>
            <p style="color:#999;font-size:12px;margin:24px 0 0">Or copy this link:<br><span style="word-break:break-all">${link}</span></p>
          </div>
        `,
      })
    } catch (e) {
      console.error("[magic] Email send failed:", e)
      // Fall through — token was generated, log it for debugging
    }
  } else {
    // No SMTP configured — log the link (useful during setup)
    console.info(`[magic] No SMTP configured. Magic link for ${email}:\n${link}`)
  }

  return NextResponse.json({ ok: true })
}

// ---------------------------------------------------------------------------
// GET — verify token and create session
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")
  if (!token) {
    return NextResponse.redirect(new URL(withBase("/login"), req.url))
  }

  const userId = await verifyMagicToken(token)
  if (!userId) {
    const url = new URL(withBase("/login"), req.url)
    url.searchParams.set("error", "expired")
    return NextResponse.redirect(url)
  }

  const sessionToken = await signSessionToken(userId)
  const res = NextResponse.redirect(new URL(withBase("/"), req.url))
  setSessionCookie(res, sessionToken)
  return res
}
