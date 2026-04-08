import { NextResponse } from "next/server"
import { verifyUserPassword } from "@/lib/db"
import { signSessionToken, setSessionCookie } from "@/lib/auth-session"

export async function POST(req: Request) {
  let body: { username?: string; password?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const username = typeof body.username === "string" ? body.username.trim() : ""
  const password = typeof body.password === "string" ? body.password : ""
  if (!username || !password) {
    return NextResponse.json({ error: "Username and password required" }, { status: 400 })
  }

  const userId = verifyUserPassword(username, password)
  if (userId == null) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 })
  }

  const token = await signSessionToken(userId)
  const res = NextResponse.json({ ok: true })
  setSessionCookie(res, token)
  return res
}
