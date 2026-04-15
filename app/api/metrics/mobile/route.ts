import { NextRequest, NextResponse } from "next/server"

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || "http://localhost:8000"

export async function GET(_req: NextRequest) {
  try {
    const res = await fetch(`${PYTHON_SERVICE_URL}/metrics/mobile`, { cache: "no-store" })
    if (!res.ok) return new NextResponse(null, { status: res.status })
    return NextResponse.json(await res.json())
  } catch {
    return new NextResponse("Analytics service unavailable", { status: 503 })
  }
}
