import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/api-auth"
import { adminDeleteUser, adminUpdateUser } from "@/lib/db"

function parseId(param: string): number | null {
  const n = parseInt(param, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  const targetId = parseId(params.id)
  if (targetId == null) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 })
  }

  let body: { username?: string; password?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const username = typeof body.username === "string" ? body.username : undefined
  const password = typeof body.password === "string" ? body.password : undefined

  if (username === undefined && (password === undefined || password === "")) {
    return NextResponse.json({ error: "Provide username and/or new password" }, { status: 400 })
  }

  const result = adminUpdateUser(auth.userId, targetId, { username, password })
  if (!result.ok) {
    const status = result.error === "User not found" ? 404 : 400
    return NextResponse.json({ error: result.error }, { status })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  const targetId = parseId(params.id)
  if (targetId == null) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 })
  }

  const result = adminDeleteUser(auth.userId, targetId)
  if (!result.ok) {
    const status =
      result.error === "User not found"
        ? 404
        : result.error === "Forbidden"
          ? 403
          : 400
    return NextResponse.json({ error: result.error }, { status })
  }
  return NextResponse.json({ ok: true })
}
