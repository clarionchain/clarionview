import { NextResponse } from "next/server"
import { clearSessionCookies } from "@/lib/auth-session"

export async function POST() {
  const res = NextResponse.json({ ok: true })
  clearSessionCookies(res)
  return res
}
