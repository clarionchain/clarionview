import { NextResponse } from "next/server"
import { requireUser } from "@/lib/api-auth"
import { changeOwnPassword } from "@/lib/db"

export async function POST(req: Request) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  let body: { currentPassword?: string; newPassword?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : ""
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : ""
  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "Current and new password required" }, { status: 400 })
  }

  const result = changeOwnPassword(auth.userId, currentPassword, newPassword)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}
