import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/api-auth"

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || "http://localhost:8000"

async function proxyToAnalytics(path: string): Promise<Response> {
  return fetch(`${PYTHON_SERVICE_URL}${path}`, { cache: "no-store" })
}

/**
 * GET /api/insights              → latest insight
 * GET /api/insights?date=X       → insight for date
 * GET /api/insights?list         → list of available insights
 * GET /api/insights?trigger      → trigger generation
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  const date = req.nextUrl.searchParams.get("date")
  const list = req.nextUrl.searchParams.has("list")
  const trigger = req.nextUrl.searchParams.has("trigger")

  try {
    if (trigger) {
      const res = await proxyToAnalytics("/insights/generate")
      const body = await res.json().catch(() => ({}))
      return NextResponse.json(body, { status: res.ok ? 200 : res.status })
    }

    if (list) {
      const res = await proxyToAnalytics("/insights/list")
      if (!res.ok) return NextResponse.json({ error: "Analytics service unavailable" }, { status: 503 })
      return NextResponse.json(await res.json())
    }

    if (date) {
      const res = await proxyToAnalytics(`/insights/${encodeURIComponent(date)}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        return NextResponse.json(body, { status: res.status })
      }
      return NextResponse.json(await res.json())
    }

    // Default: latest
    const res = await proxyToAnalytics("/insights/latest")
    if (!res.ok) {
      if (res.status === 404) return NextResponse.json({ error: "No insights generated yet" }, { status: 404 })
      return NextResponse.json({ error: "Analytics service unavailable" }, { status: 503 })
    }
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json(
      { error: "Could not reach analytics service. Ensure PYTHON_SERVICE_URL is configured." },
      { status: 503 }
    )
  }
}
