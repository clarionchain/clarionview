import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth-session"
import { isUserAdmin } from "@/lib/db"

export async function getSessionUserId(): Promise<number | null> {
  const token = cookies().get(SESSION_COOKIE)?.value
  if (!token) return null
  return verifySessionToken(token)
}

export async function requireUser(): Promise<{ userId: number } | NextResponse> {
  const userId = await getSessionUserId()
  if (userId == null) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return { userId }
}

export async function requireAdmin(): Promise<{ userId: number } | NextResponse> {
  const r = await requireUser()
  if (r instanceof NextResponse) return r
  if (!isUserAdmin(r.userId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  return r
}
