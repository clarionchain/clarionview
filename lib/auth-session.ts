import type { NextResponse } from "next/server"
import { SignJWT, jwtVerify } from "jose"

export const SESSION_COOKIE = "wb_session"

/** Cookie Path must match where the app lives (e.g. /workbench) or browsers may not send wb_session on /workbench/api/* */
export function getSessionCookiePath(): string {
  const trimmed = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/$/, "")
  return trimmed.length > 0 ? trimmed : "/"
}

function sessionCookieFlags() {
  return {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
  }
}

const SESSION_MAX_AGE = 60 * 60 * 24 * 30

/** Next `cookies.set` cannot emit two cookies with the same name; append a raw Set-Cookie for the other Path. */
function appendClearCookieHeader(res: NextResponse, cookiePath: string): void {
  const { secure, httpOnly, sameSite } = sessionCookieFlags()
  const parts = [`${SESSION_COOKIE}=`, `Path=${cookiePath}`, "Max-Age=0"]
  if (httpOnly) parts.push("HttpOnly")
  parts.push(`SameSite=${sameSite === "lax" ? "Lax" : "Strict"}`)
  if (secure) parts.push("Secure")
  res.headers.append("Set-Cookie", parts.join("; "))
}

export function setSessionCookie(res: NextResponse, token: string): void {
  const flags = sessionCookieFlags()
  const path = getSessionCookiePath()
  const base = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/$/, "")
  res.cookies.set(SESSION_COOKIE, token, {
    ...flags,
    path,
    maxAge: SESSION_MAX_AGE,
  })
  // Must run after cookies.set: ResponseCookies.replace() deletes all Set-Cookie headers.
  if (base) {
    appendClearCookieHeader(res, "/")
  }
}

export function clearSessionCookies(res: NextResponse): void {
  const flags = sessionCookieFlags()
  const base = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/$/, "")
  res.cookies.set(SESSION_COOKIE, "", { ...flags, path: getSessionCookiePath(), maxAge: 0 })
  if (base) {
    appendClearCookieHeader(res, "/")
  }
}

export function getSessionSecretBytes(): Uint8Array {
  const s = process.env.WORKBENCH_SESSION_SECRET
  if (s && s.length >= 32) {
    return new TextEncoder().encode(s)
  }
  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[workbench] WORKBENCH_SESSION_SECRET is missing or shorter than 32 chars; set it before exposing this app."
    )
    return new TextEncoder().encode("unsafe-default-change-me-32chars!!")
  }
  return new TextEncoder().encode("development-only-secret-min-32-chars!")
}

export async function signSessionToken(userId: number): Promise<string> {
  return new SignJWT({ sub: String(userId) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(getSessionSecretBytes())
}

export async function verifySessionToken(token: string): Promise<number | null> {
  try {
    const { payload } = await jwtVerify(token, getSessionSecretBytes())
    const sub = payload.sub
    if (!sub) return null
    const id = parseInt(sub, 10)
    return Number.isFinite(id) ? id : null
  } catch {
    return null
  }
}
