"use client"

import { useEffect, useRef, useState } from "react"
import { TrendingUp, TrendingDown, Minus, RefreshCw, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react"
import { cn } from "@/lib/utils"

// ── Types ─────────────────────────────────────────────────────────────────────

interface Fundamental {
  label: string
  value: number | null
  value_fmt: string
  unit: string
  zscore: number | null
  percentile: number | null
  change_30d?: number | null
  change_90d?: number | null
}

interface Company {
  ticker: string
  name: string
  price: number
  change_1d: number | null
  change_7d: number | null
  change_30d: number | null
  change_ytd: number | null
  market_cap: number | null
  vol_10d_avg: number | null
  beta_btc: number | null
}

interface MiningData {
  generated_at: string
  fundamentals: {
    hash_rate?: Fundamental
    puell_multiple?: Fundamental
    difficulty?: Fundamental
  }
  hash_rate_series: { time: string; value: number }[]
  puell_series: { time: string; value: number }[]
  companies: Company[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt_mktcap(v: number | null): string {
  if (v == null) return "—"
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`
  return `$${v.toLocaleString()}`
}

function fmt_vol(v: number | null): string {
  if (v == null) return "—"
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`
  return v.toLocaleString()
}

function PctCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground">—</span>
  const pos = value > 0
  const neg = value < 0
  return (
    <span className={cn("font-mono tabular-nums", pos && "text-emerald-400", neg && "text-red-400")}>
      {pos ? "+" : ""}{value.toFixed(2)}%
    </span>
  )
}

function PercentileBar({ percentile, zscore }: { percentile: number | null; zscore: number | null }) {
  if (percentile == null) return <span className="text-muted-foreground text-xs">N/A</span>
  const color =
    percentile >= 85 ? "bg-red-500" :
    percentile >= 65 ? "bg-orange-400" :
    percentile <= 15 ? "bg-emerald-500" :
    percentile <= 35 ? "bg-emerald-400/70" :
    "bg-zinc-500"
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="relative h-1.5 flex-1 rounded-full bg-zinc-800 overflow-hidden">
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full", color)}
          style={{ width: `${percentile}%` }}
        />
        <div className="absolute top-0 bottom-0 w-px bg-zinc-600" style={{ left: "50%" }} />
      </div>
      <span className="text-xs font-mono text-muted-foreground w-8 text-right">
        {percentile.toFixed(0)}%
      </span>
    </div>
  )
}

type SortKey = "ticker" | "price" | "change_1d" | "change_7d" | "change_30d" | "change_ytd" | "market_cap" | "beta_btc"

// ── Lightweight chart ─────────────────────────────────────────────────────────

interface MiniChartProps {
  data: { time: string; value: number }[]
  color: string
  label: string
  zones?: { upper: number; lower: number }  // for Puell coloring
}

function MiniChart({ data, color, label, zones }: MiniChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return
    let chart: unknown
    let cleanup = false

    import("lightweight-charts").then((lc) => {
      if (cleanup || !containerRef.current) return
      chart = lc.createChart(containerRef.current, {
        layout: { background: { color: "transparent" }, textColor: "#71717a" },
        grid: { vertLines: { color: "#27272a" }, horzLines: { color: "#27272a" } },
        rightPriceScale: { borderColor: "#3f3f46" },
        timeScale: { borderColor: "#3f3f46", timeVisible: true },
        crosshair: { mode: 1 },
        height: 180,
        width: containerRef.current.clientWidth,
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = chart as any
      const series = c.addSeries(lc.LineSeries, {
        color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
      })
      series.setData(data)
      c.timeScale().fitContent()
    })

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(chart as any)?.applyOptions({ width: containerRef.current.clientWidth })
      }
    })
    if (containerRef.current) ro.observe(containerRef.current)

    return () => {
      cleanup = true
      ro.disconnect()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(chart as any)?.remove()
    }
  }, [data, color, zones])

  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
      <div ref={containerRef} className="w-full" style={{ height: 180 }} />
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MiningDashboardPage() {
  const [data, setData] = useState<MiningData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>("market_cap")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/mining", { cache: "no-store" })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  const sorted = data
    ? [...data.companies].sort((a, b) => {
        const av = a[sortKey] ?? (sortDir === "desc" ? -Infinity : Infinity)
        const bv = b[sortKey] ?? (sortDir === "desc" ? -Infinity : Infinity)
        if (typeof av === "string" && typeof bv === "string") {
          return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av)
        }
        return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number)
      })
    : []

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <ArrowUpDown className="h-3 w-3 opacity-40" />
    return sortDir === "asc"
      ? <ArrowUp className="h-3 w-3 text-orange-400" />
      : <ArrowDown className="h-3 w-3 text-orange-400" />
  }

  function ColHeader({ k, label, className }: { k: SortKey; label: string; className?: string }) {
    return (
      <th
        className={cn("px-3 py-2.5 text-left text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none whitespace-nowrap", className)}
        onClick={() => toggleSort(k)}
      >
        <span className="inline-flex items-center gap-1">{label}<SortIcon k={k} /></span>
      </th>
    )
  }

  const fund = data?.fundamentals

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Bitcoin Mining</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Network fundamentals and public mining company performance
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors disabled:opacity-40"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Fundamentals strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          fund?.hash_rate,
          fund?.puell_multiple,
          fund?.difficulty,
        ].map((f, i) => {
          if (!f) return (
            <div key={i} className="rounded-xl border border-border bg-card p-4 animate-pulse h-28" />
          )
          const pct = f.percentile
          const zoneColor =
            pct != null && pct >= 85 ? "text-red-400" :
            pct != null && pct >= 65 ? "text-orange-400" :
            pct != null && pct <= 15 ? "text-emerald-400" :
            "text-foreground"
          return (
            <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{f.label}</p>
              <p className={cn("text-2xl font-bold font-mono", zoneColor)}>
                {f.value_fmt}
              </p>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                {f.percentile != null && (
                  <span>P{f.percentile.toFixed(0)} historical</span>
                )}
                {f.change_30d != null && (
                  <span className={f.change_30d >= 0 ? "text-emerald-400" : "text-red-400"}>
                    {f.change_30d >= 0 ? "+" : ""}{f.change_30d.toFixed(1)}% 30d
                  </span>
                )}
              </div>
              {f.percentile != null && (
                <div className="relative h-1 rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className={cn("absolute inset-y-0 left-0 rounded-full",
                      pct != null && pct >= 85 ? "bg-red-500" :
                      pct != null && pct >= 65 ? "bg-orange-400" :
                      pct != null && pct <= 15 ? "bg-emerald-500" :
                      pct != null && pct <= 35 ? "bg-emerald-400/70" :
                      "bg-zinc-500"
                    )}
                    style={{ width: `${f.percentile}%` }}
                  />
                  <div className="absolute top-0 bottom-0 w-px bg-zinc-600" style={{ left: "50%" }} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Company table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold">Public Mining Companies</h2>
          <span className="text-xs text-muted-foreground">
            {loading ? "Loading…" : `${data?.companies.length ?? 0} companies`}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                <ColHeader k="ticker" label="Ticker" />
                <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">Company</th>
                <ColHeader k="price" label="Price" className="text-right" />
                <ColHeader k="change_1d" label="1D" className="text-right" />
                <ColHeader k="change_7d" label="7D" className="text-right" />
                <ColHeader k="change_30d" label="30D" className="text-right" />
                <ColHeader k="change_ytd" label="YTD" className="text-right" />
                <ColHeader k="market_cap" label="Mkt Cap" className="text-right" />
                <th className="px-3 py-2.5 text-right text-xs font-medium text-muted-foreground whitespace-nowrap">Vol 10D</th>
                <ColHeader k="beta_btc" label="β vs BTC" className="text-right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading && !data && Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 10 }).map((_, j) => (
                    <td key={j} className="px-3 py-3">
                      <div className="h-4 rounded bg-zinc-800 animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))}
              {sorted.map((co) => (
                <tr key={co.ticker} className="hover:bg-accent/20 transition-colors">
                  <td className="px-3 py-3 font-mono font-semibold text-orange-400 whitespace-nowrap">
                    {co.ticker}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground text-xs max-w-[140px] truncate">
                    {co.name}
                  </td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums">
                    ${co.price.toFixed(2)}
                  </td>
                  <td className="px-3 py-3 text-right"><PctCell value={co.change_1d} /></td>
                  <td className="px-3 py-3 text-right"><PctCell value={co.change_7d} /></td>
                  <td className="px-3 py-3 text-right"><PctCell value={co.change_30d} /></td>
                  <td className="px-3 py-3 text-right"><PctCell value={co.change_ytd} /></td>
                  <td className="px-3 py-3 text-right font-mono text-xs tabular-nums">
                    {fmt_mktcap(co.market_cap)}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {fmt_vol(co.vol_10d_avg)}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-xs tabular-nums">
                    {co.beta_btc != null ? (
                      <span className={co.beta_btc > 1.5 ? "text-orange-400" : co.beta_btc < 0.5 ? "text-muted-foreground" : ""}>
                        {co.beta_btc.toFixed(2)}
                      </span>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Charts */}
      {data && (data.hash_rate_series.length > 0 || data.puell_series.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {data.hash_rate_series.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <MiniChart
                data={data.hash_rate_series}
                color="#f7931a"
                label="Network Hash Rate (1Y)"
              />
            </div>
          )}
          {data.puell_series.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <MiniChart
                data={data.puell_series}
                color="#60a5fa"
                label="Puell Multiple (1Y)"
              />
              <p className="text-xs text-muted-foreground mt-2">
                <span className="text-emerald-400 font-medium">&lt; 0.5</span> oversold miner revenue ·{" "}
                <span className="text-red-400 font-medium">&gt; 2.0</span> elevated miner revenue
              </p>
            </div>
          )}
        </div>
      )}

      {data && (
        <p className="text-xs text-muted-foreground">
          Updated {new Date(data.generated_at).toLocaleString()} · Data: BitView + Yahoo Finance · β computed over 90-day rolling window vs BTC daily returns
        </p>
      )}
    </div>
  )
}
