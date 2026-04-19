import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/api-auth"

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || "http://localhost:8000"

export async function GET(req: NextRequest) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  const ticker = req.nextUrl.searchParams.get("ticker")
  if (!ticker) return NextResponse.json({ error: "ticker required" }, { status: 400 })

  try {
    const res = await fetch(
      `${PYTHON_SERVICE_URL}/data/yf?ticker=${encodeURIComponent(ticker)}`,
      { cache: "no-store" }
    )
    if (!res.ok) return NextResponse.json({ error: "upstream error" }, { status: res.status })
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json({ error: "service unavailable" }, { status: 503 })
  }
}
