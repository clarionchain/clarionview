import { NextRequest, NextResponse } from "next/server"

const BITVIEW_BASE = "https://bitview.space"
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || "http://localhost:8000"

/** BitView series that only expose `height` — map to a `day`-indexed variant for this app. */
const SERIES_DAY_ALIASES: Record<string, string> = {
  net_realized_pnl: "net_realized_pnl_cumulative",
  realized_profit: "realized_profit_cumulative",
  realized_loss: "realized_loss_cumulative",
}

function upstreamSeriesName(requested: string): string {
  return SERIES_DAY_ALIASES[requested] ?? requested
}

function bitviewErrorToPayload(body: unknown, fallback: string): { error: string; code?: string } {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return { error: fallback }
  }
  const wrap = body as { error: unknown }
  const e = wrap.error
  if (typeof e === "string") return { error: e }
  if (typeof e === "object" && e !== null && "message" in e) {
    const m = (e as { message?: unknown }).message
    const c = (e as { code?: unknown }).code
    if (typeof m === "string") {
      return typeof c === "string" ? { error: m, code: c } : { error: m }
    }
  }
  return { error: fallback }
}

let cachedDates: string[] | null = null
let cachedDatesAt = 0
const CACHE_TTL = 3600_000

async function getDates(): Promise<string[]> {
  const now = Date.now()
  if (cachedDates && now - cachedDatesAt < CACHE_TTL) {
    return cachedDates
  }
  const res = await fetch(`${BITVIEW_BASE}/api/series/date/day`, { cache: "no-store" })
  if (!res.ok) throw new Error(`Failed to fetch dates: ${res.status}`)
  const json = await res.json()
  cachedDates = json.data
  cachedDatesAt = now
  return cachedDates!
}

/** Fetch from the Python analytics service (Yahoo Finance or FRED). */
async function fetchFromAnalytics(
  endpoint: string,
  params: Record<string, string>
): Promise<NextResponse> {
  const url = new URL(`${PYTHON_SERVICE_URL}${endpoint}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  try {
    const res = await fetch(url.toString(), { cache: "no-store" })
    if (!res.ok) {
      let errMsg = `Analytics service returned ${res.status}`
      try {
        const body = await res.json()
        if (typeof body?.detail === "string") errMsg = body.detail
      } catch {
        /* ignore */
      }
      // Never forward 503 as-is without context
      const status = res.status === 503 ? 503 : res.status >= 500 ? 502 : res.status
      return NextResponse.json({ error: errMsg }, { status })
    }

    const payload = await res.json()
    const response = NextResponse.json(payload)
    // Short cache for equity data — prices update daily
    response.headers.set("Cache-Control", "public, s-maxage=900, stale-while-revalidate=3600")
    return response
  } catch (e) {
    // Python service unreachable
    return NextResponse.json(
      {
        error:
          "Analytics service unavailable. Ensure the Python service is running. " +
          `(PYTHON_SERVICE_URL=${PYTHON_SERVICE_URL})`,
      },
      { status: 503 }
    )
  }
}

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name")
  if (!name) {
    return NextResponse.json({ error: "name parameter required" }, { status: 400 })
  }

  // ── Yahoo Finance series (yf:TICKER) ──────────────────────────────────────
  if (name.startsWith("yf:")) {
    const ticker = name.slice(3)
    if (!ticker) return NextResponse.json({ error: "Ticker required after yf:" }, { status: 400 })
    return fetchFromAnalytics("/data/yf", { ticker })
  }

  // ── FRED series (fred:SERIES_ID) ──────────────────────────────────────────
  if (name.startsWith("fred:")) {
    const series = name.slice(5)
    if (!series) return NextResponse.json({ error: "Series ID required after fred:" }, { status: 400 })
    return fetchFromAnalytics("/data/fred", { series })
  }

  // ── BitView on-chain series (default) ─────────────────────────────────────
  try {
    const upstream = upstreamSeriesName(name)
    const [dates, valuesRes] = await Promise.all([
      getDates(),
      fetch(`${BITVIEW_BASE}/api/series/${encodeURIComponent(upstream)}/day/data`, {
        cache: "no-store",
      }),
    ])

    if (!valuesRes.ok) {
      const st = valuesRes.status
      if (st === 401 || st === 403) {
        return NextResponse.json(
          {
            error: `BitView returned ${st} for this series (not your ClarionChain login). Try again later or pick another metric.`,
            code: "BITVIEW_UPSTREAM",
          },
          { status: 502 }
        )
      }
      let errBody: unknown = null
      try {
        errBody = await valuesRes.json()
      } catch {
        /* use default */
      }
      const payload = bitviewErrorToPayload(
        errBody,
        upstream !== name
          ? `Series '${name}' is not available on the daily index; try another metric.`
          : `Series '${name}' request failed (HTTP ${st})`
      )
      return NextResponse.json(payload, { status: st })
    }

    const values: (number | null)[] = await valuesRes.json()

    const data: { time: string; value: number }[] = []
    const len = Math.min(dates.length, values.length)
    for (let i = 0; i < len; i++) {
      if (values[i] != null && dates[i]) {
        data.push({ time: dates[i], value: values[i] as number })
      }
    }

    const response = NextResponse.json({ data, total: data.length })
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=3600, stale-while-revalidate=86400"
    )
    return response
  } catch (e) {
    console.error("Failed to fetch series:", name, e)
    return NextResponse.json(
      { error: "Failed to fetch series data" },
      { status: 500 }
    )
  }
}
