import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/api-auth"
import { getUserById, getUserEmail, setUserEmail } from "@/lib/db"

export async function GET() {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth
  const user = getUserById(auth.userId)
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })
  const email = getUserEmail(auth.userId)
  return NextResponse.json({
    id: user.id,
    username: user.username,
    is_admin: user.is_admin,
    email,
  })
}

export async function PATCH(req: NextRequest) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  const body = (await req.json().catch(() => ({}))) as { email?: string | null }

  if ("email" in body) {
    const email = typeof body.email === "string" ? body.email.trim() || null : null
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 })
    }
    setUserEmail(auth.userId, email)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
}
