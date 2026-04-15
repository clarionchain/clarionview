import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/api-auth"

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || "http://localhost:8000"

export async function GET(
  _req: NextRequest,
  { params }: { params: { date: string } }
) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  const { date } = params
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new NextResponse("Invalid date", { status: 400 })
  }

  try {
    const res = await fetch(
      `${PYTHON_SERVICE_URL}/report/${encodeURIComponent(date)}/infographic.png`,
      { cache: "no-store" }
    )
    if (!res.ok) return new NextResponse(null, { status: res.status })
    const buf = await res.arrayBuffer()
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600",
        "Content-Disposition": `inline; filename="${date}_report.png"`,
      },
    })
  } catch {
    return new NextResponse("Analytics service unavailable", { status: 503 })
  }
}
