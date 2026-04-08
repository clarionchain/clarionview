import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/api-auth"
import { createUserAccount, listUsersForAdmin } from "@/lib/db"

export async function GET() {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  return NextResponse.json(listUsersForAdmin())
}

export async function POST(req: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  let body: { username?: string; password?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const username = typeof body.username === "string" ? body.username : ""
  const password = typeof body.password === "string" ? body.password : ""
  if (!username.trim() || !password) {
    return NextResponse.json({ error: "Username and password required" }, { status: 400 })
  }

  const result = createUserAccount(username, password)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  return NextResponse.json({ ok: true, id: result.id })
}
