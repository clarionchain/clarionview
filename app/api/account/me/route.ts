import { NextResponse } from "next/server"
import { requireUser } from "@/lib/api-auth"
import { getUserById } from "@/lib/db"

export async function GET() {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth
  const user = getUserById(auth.userId)
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }
  return NextResponse.json({
    id: user.id,
    username: user.username,
    is_admin: user.is_admin,
  })
}
