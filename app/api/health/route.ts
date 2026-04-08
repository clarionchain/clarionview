import { NextResponse } from "next/server"
import { getDb } from "@/lib/db"

export async function GET() {
  try {
    // Light DB check — just confirm we can query
    const db = getDb()
    const row = db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number }

    return NextResponse.json({
      status: "ok",
      db: "ok",
      users: row.c,
      time: new Date().toISOString(),
    })
  } catch (e) {
    return NextResponse.json(
      { status: "error", error: String(e) },
      { status: 500 }
    )
  }
}
