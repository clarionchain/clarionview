"use client"

import { useState, useEffect, useCallback } from "react"
import { BarChart2, Loader2, RefreshCw, AlertCircle, ArrowUpDown } from "lucide-react"
import { withBase } from "@/lib/base-path"
import { cn } from "@/lib/utils"

// ── Types ─────────────────────────────────────────────────────────────────────

interface Metric {
  label: string
  category: string
  value: number
  value_fmt: string
  zscore: number | null
  percentile: number | null
  history_points: number
  note?: string
}

interface MetricsResult {
  generated_at: string
  metrics: Metric[]
}

type SortMode = "extremeness" | "percentile_asc" | "percentile_desc" | "category"

// ── Helpers ───────────────────────────────────────────────────────────────────

/** 0 = perfectly middle (50th), 100 = maximally extreme (0th or 100th) */
function extremeness(m: Metric): number {
  if (m.percentile == null) return -1
  return Math.abs(m.percentile - 50) * 2  // 0–100
}

function pctLabel(pct: number | null): string {
  if (pct == null) return "—"
  if (pct >= 90) return "Top 10%"
  if (pct >= 80) return "Top 20%"
  if (pct >= 65) return "Above avg"
  if (pct <= 10) return "Bottom 10%"
  if (pct <= 20) return "Bottom 20%"
  if (pct <= 35) return "Below avg"
  return "Neutral"
}

function pctBarColor(pct: number | null): string {
  if (pct == null) return "bg-border/40"
  if (pct >= 90) return "bg-rose-500"
  if (pct >= 75) return "bg-amber-500"
  if (pct >= 55) return "bg-amber-400/60"
  if (pct <= 10) return "bg-emerald-500"
  if (pct <= 25) return "bg-cyan-500"
  if (pct <= 45) return "bg-cyan-400/60"
  return "bg-muted-foreground/30"
}

function pctTextColor(pct: number | null): string {
  if (pct == null) return "text-muted-foreground/40"
  if (pct >= 90) return "text-rose-400"
  if (pct >= 75) return "text-amber-400"
  if (pct >= 55) return "text-amber-300/70"
  if (pct <= 10) return "text-emerald-400"
  if (pct <= 25) return "text-cyan-400"
  if (pct <= 45) return "text-cyan-300/70"
  return "text-muted-foreground/50"
}

function zColor(z: number | null): string {
  if (z == null) return "text-muted-foreground/30"
  if (Math.abs(z) >= 2) return z > 0 ? "text-rose-400" : "text-emerald-400"
  if (Math.abs(z) >= 1) return z > 0 ? "text-amber-400" : "text-cyan-400"
  return "text-muted-foreground/50"
}

const CATEGORIES = ["On-Chain", "Pricing", "Supply", "Mining", "Price", "ETF / Equities"]

const CATEGORY_COLORS: Record<string, string> = {
  "On-Chain":      "border-cyan-500/30 text-cyan-400",
  "Pricing":       "border-orange-500/30 text-orange-400",
  "Supply":        "border-purple-500/30 text-purple-400",
  "Mining":        "border-yellow-500/30 text-yellow-400",
  "Price":         "border-orange-400/30 text-orange-300",
  "ETF / Equities":"border-blue-500/30 text-blue-400",
}

// ── Metric row ────────────────────────────────────────────────────────────────

function MetricRow({ m, rank }: { m: Metric; rank?: number }) {
  const pct = m.percentile
  const ex = extremeness(m)
  const isExtreme = ex >= 70

  return (
    <div className={cn(
      "flex items-center gap-3 px-4 py-3 border-b border-border/10 last:border-0 transition-colors hover:bg-accent/10",
      isExtreme && "bg-accent/5",
    )}>
      {/* Rank */}
      {rank != null && (
        <div className="w-6 text-[10px] text-muted-foreground/25 tabular-nums text-right shrink-0">
          {rank}
        </div>
      )}

      {/* Label + category */}
      <div className="w-44 shrink-0">
        <div className="text-sm font-medium text-foreground/90 truncate">{m.label}</div>
        <span className={cn(
          "text-[10px] border rounded px-1 py-px",
          CATEGORY_COLORS[m.category] ?? "border-border/30 text-muted-foreground/40"
        )}>
          {m.category}
        </span>
      </div>

      {/* Value */}
      <div className="w-32 shrink-0 tabular-nums text-sm font-mono text-right text-foreground/80">
        {m.value_fmt}
      </div>

      {/* Z-score */}
      <div className={cn("w-20 shrink-0 text-sm font-mono text-right", zColor(m.zscore))}>
        {m.zscore != null ? `${m.zscore > 0 ? "+" : ""}${m.zscore.toFixed(2)}σ` : "—"}
      </div>

      {/* Percentile bar */}
      <div className="flex-1 min-w-0 flex items-center gap-3">
        <div className="flex-1 relative h-2 bg-border/20 rounded-full overflow-hidden">
          {/* Center tick */}
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border/40" />
          {pct != null && (
            <div
              className={cn("absolute top-0 bottom-0 rounded-full", pctBarColor(pct))}
              style={{ left: 0, width: `${pct}%` }}
            />
          )}
        </div>
        <div className={cn("w-16 shrink-0 text-right text-xs font-mono tabular-nums", pctTextColor(pct))}>
          {pct != null ? `${pct.toFixed(0)}th` : "—"}
        </div>
        <div className={cn("w-20 shrink-0 text-right text-[11px]", pctTextColor(pct))}>
          {pctLabel(pct)}
        </div>
      </div>

      {/* History */}
      <div className="w-14 shrink-0 text-[10px] text-muted-foreground/25 text-right tabular-nums">
        {m.history_points > 0 ? `${m.history_points}d` : ""}
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function MetricsPage() {
  const [data, setData] = useState<MetricsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState<SortMode>("extremeness")
  const [filterCat, setFilterCat] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(withBase("/api/metrics"), { credentials: "include" })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setData(await r.json())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load metrics")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const sortedMetrics = (() => {
    if (!data) return []
    let items = data.metrics.filter((m) => m.percentile != null || m.zscore != null)
    if (filterCat) items = items.filter((m) => m.category === filterCat)
    switch (sort) {
      case "extremeness":
        return [...items].sort((a, b) => extremeness(b) - extremeness(a))
      case "percentile_asc":
        return [...items].sort((a, b) => (a.percentile ?? 50) - (b.percentile ?? 50))
      case "percentile_desc":
        return [...items].sort((a, b) => (b.percentile ?? 50) - (a.percentile ?? 50))
      case "category":
        return [...items].sort((a, b) =>
          CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) ||
          extremeness(b) - extremeness(a)
        )
    }
  })()

  // Summary stats
  const extreme = data?.metrics.filter((m) => m.percentile != null && (m.percentile >= 80 || m.percentile <= 20)) ?? []
  const top10   = data?.metrics.filter((m) => m.percentile != null && m.percentile >= 90) ?? []
  const bot10   = data?.metrics.filter((m) => m.percentile != null && m.percentile <= 10) ?? []

  return (
    <div className="flex flex-col h-full -m-4 lg:-m-6">
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/30 bg-card/80 px-4 backdrop-blur-md">
        <BarChart2 className="h-4 w-4 text-muted-foreground/50" />
        <span className="text-sm font-medium">Metric Percentiles</span>
        {data && (
          <span className="text-xs text-muted-foreground/30 ml-1">
            — {new Date(data.generated_at).toLocaleTimeString()}
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent/30 rounded transition-colors"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-muted-foreground/40">
          <Loader2 className="h-7 w-7 animate-spin" />
          <p className="text-sm">Fetching on-chain data & computing percentiles…</p>
          <p className="text-xs">This may take 10–20 seconds</p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-rose-400/70">
          <AlertCircle className="h-7 w-7" />
          <p className="text-sm">{error}</p>
          <button onClick={load} className="text-xs underline text-muted-foreground/50 hover:text-muted-foreground">Retry</button>
        </div>
      ) : data ? (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">

          {/* ── Summary strip ── */}
          <div className="flex items-center gap-6 px-4 py-3 border-b border-border/20 bg-card/10 shrink-0 flex-wrap">
            <div className="text-xs text-muted-foreground/40">
              <span className="text-foreground/70 font-medium">{data.metrics.length}</span> metrics tracked
            </div>
            {extreme.length > 0 && (
              <div className="text-xs text-muted-foreground/40">
                <span className="text-amber-400 font-medium">{extreme.length}</span> outside normal range
              </div>
            )}
            {top10.length > 0 && (
              <div className="text-xs text-muted-foreground/40">
                <span className="text-rose-400 font-medium">{top10.length}</span> in top 10%
                {top10.map(m => (
                  <span key={m.label} className="ml-1 text-rose-400/70">{m.label}</span>
                ))}
              </div>
            )}
            {bot10.length > 0 && (
              <div className="text-xs text-muted-foreground/40">
                <span className="text-emerald-400 font-medium">{bot10.length}</span> in bottom 10%
                {bot10.map(m => (
                  <span key={m.label} className="ml-1 text-emerald-400/70">{m.label}</span>
                ))}
              </div>
            )}
          </div>

          {/* ── Controls ── */}
          <div className="flex items-center gap-3 px-4 py-2 border-b border-border/15 shrink-0 flex-wrap">
            {/* Sort */}
            <div className="flex items-center gap-1.5">
              <ArrowUpDown className="h-3 w-3 text-muted-foreground/40" />
              <span className="text-[11px] text-muted-foreground/40 mr-1">Sort:</span>
              {(["extremeness", "percentile_desc", "percentile_asc", "category"] as SortMode[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setSort(s)}
                  className={cn(
                    "text-[11px] px-2 py-0.5 rounded transition-colors",
                    sort === s
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground/50 hover:text-foreground hover:bg-accent/30"
                  )}
                >
                  {s === "extremeness" ? "Most extreme" :
                   s === "percentile_desc" ? "Highest %" :
                   s === "percentile_asc" ? "Lowest %" : "Category"}
                </button>
              ))}
            </div>

            <div className="w-px h-4 bg-border/20" />

            {/* Category filter */}
            <div className="flex items-center gap-1 flex-wrap">
              <button
                onClick={() => setFilterCat(null)}
                className={cn(
                  "text-[11px] px-2 py-0.5 rounded transition-colors",
                  filterCat === null
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground/50 hover:text-foreground hover:bg-accent/30"
                )}
              >All</button>
              {CATEGORIES.filter(c => data.metrics.some(m => m.category === c)).map((c) => (
                <button
                  key={c}
                  onClick={() => setFilterCat(c === filterCat ? null : c)}
                  className={cn(
                    "text-[11px] px-2 py-0.5 rounded border transition-colors",
                    filterCat === c
                      ? "bg-accent text-accent-foreground border-transparent"
                      : cn("border-transparent", CATEGORY_COLORS[c] ?? "text-muted-foreground/50", "hover:bg-accent/30")
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* ── Column headers ── */}
          <div className="flex items-center gap-3 px-4 py-1.5 border-b border-border/10 bg-card/20 shrink-0">
            <div className="w-6" />
            <div className="w-44 text-[10px] text-muted-foreground/30 uppercase tracking-wider">Metric</div>
            <div className="w-32 text-[10px] text-muted-foreground/30 uppercase tracking-wider text-right">Value</div>
            <div className="w-20 text-[10px] text-muted-foreground/30 uppercase tracking-wider text-right">Z-Score</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3">
                <div className="flex-1 text-[10px] text-muted-foreground/30 uppercase tracking-wider">
                  Percentile — how often price is at or below this level
                </div>
                <div className="w-16 text-[10px] text-muted-foreground/30 uppercase tracking-wider text-right">Pct</div>
                <div className="w-20 text-[10px] text-muted-foreground/30 uppercase tracking-wider text-right">Reading</div>
              </div>
            </div>
            <div className="w-14 text-[10px] text-muted-foreground/30 uppercase tracking-wider text-right">History</div>
          </div>

          {/* ── Rows ── */}
          <div className="flex-1 overflow-y-auto">
            {sortedMetrics.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-sm text-muted-foreground/30">
                No metrics with percentile data available
              </div>
            ) : (
              sortedMetrics.map((m, i) => (
                <MetricRow key={`${m.category}-${m.label}`} m={m} rank={i + 1} />
              ))
            )}
          </div>

          {/* ── Legend ── */}
          <div className="shrink-0 flex items-center gap-4 px-4 py-2 border-t border-border/10 bg-card/10 flex-wrap">
            <span className="text-[10px] text-muted-foreground/30">Percentile legend:</span>
            {[
              { label: "Top 10% (historically extreme high)", cls: "bg-rose-500" },
              { label: "Top 25%", cls: "bg-amber-500" },
              { label: "Middle 50%", cls: "bg-muted-foreground/30" },
              { label: "Bottom 25%", cls: "bg-cyan-500" },
              { label: "Bottom 10% (historically extreme low)", cls: "bg-emerald-500" },
            ].map((l) => (
              <span key={l.label} className="flex items-center gap-1.5 text-[10px] text-muted-foreground/40">
                <span className={cn("inline-block w-2.5 h-2.5 rounded-sm", l.cls)} />
                {l.label}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
