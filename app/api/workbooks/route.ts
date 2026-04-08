import { NextRequest, NextResponse } from "next/server"
import { getSessionUserId } from "@/lib/api-auth"
import type { SavedWorkbook } from "@/lib/workbench-types"
import { listWorkbooksForUser, upsertWorkbook, deleteWorkbook } from "@/lib/workbook-db"
import { normalizeSeriesConfigs } from "@/lib/workbench-types"

export async function GET() {
  const userId = await getSessionUserId()
  if (userId == null) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return NextResponse.json(listWorkbooksForUser(userId))
}

export async function POST(req: Request) {
  const userId = await getSessionUserId()
  if (userId == null) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  let body: SavedWorkbook
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  if (!body || typeof body.name !== "string" || !Array.isArray(body.configs)) {
    return NextResponse.json({ error: "Invalid workbook payload" }, { status: 400 })
  }
  const wb: SavedWorkbook = {
    ...body,
    configs: normalizeSeriesConfigs(body.configs),
    savedAt: body.savedAt || new Date().toISOString(),
  }
  const saved = upsertWorkbook(userId, wb)
  return NextResponse.json(saved)
}

export async function DELETE(req: NextRequest) {
  const userId = await getSessionUserId()
  if (userId == null) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const id = req.nextUrl.searchParams.get("id")
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 })
  }
  const ok = deleteWorkbook(userId, id)
  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
