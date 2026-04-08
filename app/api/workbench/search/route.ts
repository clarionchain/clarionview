import { NextRequest, NextResponse } from "next/server"
import { MARKET_METRICS_FLAT } from "@/lib/market-categories"

const BITVIEW_BASE = "https://bitview.space"

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") || "").trim().toLowerCase()
  if (!q) {
    return NextResponse.json([])
  }

  // Search market categories locally (instant, no network)
  const marketMatches = MARKET_METRICS_FLAT.filter(
    (m) =>
      m.display.toLowerCase().includes(q) ||
      m.name.toLowerCase().includes(q) ||
      (m.ticker && m.ticker.toLowerCase().includes(q))
  )
    .slice(0, 20)
    .map((m) => ({ name: m.name, display: m.display, source: "market" }))

  // Search BitView on-chain series (network)
  let bitviewMatches: { name: string; display?: string; source: string }[] = []
  try {
    const res = await fetch(`${BITVIEW_BASE}/api/series/search?q=${encodeURIComponent(q)}`, {
      cache: "no-store",
    })
    if (res.ok) {
      const data = await res.json()
      bitviewMatches = (Array.isArray(data) ? data.slice(0, 60) : []).map((name: string) => ({
        name,
        source: "bitview",
      }))
    }
  } catch {
    /* BitView search failure is non-fatal */
  }

  // Merge: market results first (more likely what user wants when searching tickers),
  // then BitView results, deduplicating by name.
  const seen = new Set<string>()
  const merged: { name: string; display?: string; source: string }[] = []

  for (const item of [...marketMatches, ...bitviewMatches]) {
    if (!seen.has(item.name)) {
      seen.add(item.name)
      merged.push(item)
    }
  }

  // Return just names array for backwards compat with the metric panel
  // (it calls formatSeriesName on the name for display)
  // But for market results, include the display name so it can be shown correctly.
  return NextResponse.json(
    merged.slice(0, 80).map((m) => ({
      name: m.name,
      display: m.display,
    }))
  )
}
