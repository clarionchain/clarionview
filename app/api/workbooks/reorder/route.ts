import { NextResponse } from "next/server"
import { getSessionUserId } from "@/lib/api-auth"
import { reorderWorkbooks } from "@/lib/workbook-db"

export async function PATCH(req: Request) {
  const userId = await getSessionUserId()
  if (userId == null) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  let body: { ids?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  if (!Array.isArray(body.ids) || !body.ids.every((x) => typeof x === "string")) {
    return NextResponse.json({ error: "ids: string[] required" }, { status: 400 })
  }
  reorderWorkbooks(userId, body.ids as string[])
  return NextResponse.json({ ok: true })
}
