import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/api-auth"

const PYTHON = process.env.PYTHON_SERVICE_URL || "http://localhost:8000"

/** GET /api/intel — returns status of latest intel generation */
export async function GET() {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  try {
    const r = await fetch(`${PYTHON}/intel/latest`, { cache: "no-store" })
    if (r.status === 404) {
      return NextResponse.json({ generated: false }, { status: 200 })
    }
    const data = await r.json()
    return NextResponse.json({ generated: true, ...data })
  } catch {
    return NextResponse.json({ error: "Analytics service unavailable" }, { status: 502 })
  }
}

/** POST /api/intel — trigger intel generation */
export async function POST() {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  try {
    const r = await fetch(`${PYTHON}/intel/generate`, {
      method: "POST",
      cache: "no-store",
    })
    const data = await r.json()
    return NextResponse.json(data, { status: r.ok ? 200 : 502 })
  } catch {
    return NextResponse.json({ error: "Analytics service unavailable" }, { status: 502 })
  }
}
