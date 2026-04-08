import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/api-auth"

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || "http://localhost:8000"

async function proxyToAnalytics(path: string): Promise<Response> {
  return fetch(`${PYTHON_SERVICE_URL}${path}`, { cache: "no-store" })
}

/** GET /api/reports         → list of available reports
 *  GET /api/reports?date=X  → full report for that date
 *  GET /api/reports?trigger → trigger new report generation
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  const date = req.nextUrl.searchParams.get("date")
  const trigger = req.nextUrl.searchParams.has("trigger")

  try {
    if (trigger) {
      const res = await proxyToAnalytics("/report/generate")
      const body = await res.json().catch(() => ({}))
      return NextResponse.json(body, { status: res.ok ? 200 : res.status })
    }

    if (date) {
      const res = await proxyToAnalytics(`/report/${encodeURIComponent(date)}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        return NextResponse.json(body, { status: res.status })
      }
      const report = await res.json()
      return NextResponse.json(report)
    }

    // List all reports
    const res = await proxyToAnalytics("/report/list")
    if (!res.ok) {
      return NextResponse.json(
        { error: "Analytics service unavailable" },
        { status: 503 }
      )
    }
    const list = await res.json()
    return NextResponse.json(list)
  } catch {
    return NextResponse.json(
      { error: "Could not reach analytics service. Ensure PYTHON_SERVICE_URL is configured and the service is running." },
      { status: 503 }
    )
  }
}
