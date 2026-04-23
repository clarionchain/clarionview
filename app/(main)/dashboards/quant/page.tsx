"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { FlaskConical, Loader2, RefreshCw, AlertCircle } from "lucide-react"
import { withBase } from "@/lib/base-path"
import { cn } from "@/lib/utils"
import {
  MODEL_SPECS, getSpec, regimeColor, fmtPrice,
  type ChartSeries, type ModelId, type QuantResult, type StatRow as StatRowSpec,
} from "@/lib/quant-models"

// ── Mini chart using lightweight-charts ──────────────────────────────────────

function MiniChart({ series, height = 110 }: { series: ChartSeries[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current || !series.length) return
    let chart: import("lightweight-charts").IChartApi | null = null

    import("lightweight-charts").then((lc) => {
      if (!ref.current) return
      chart = lc.createChart(ref.current, {
        width: ref.current.clientWidth,
        height,
        layout: { background: { color: "transparent" }, textColor: "#78829680" },
        grid: { vertLines: { color: "#23293820" }, horzLines: { color: "#23293820" } },
        rightPriceScale: { borderColor: "#232938", scaleMargins: { top: 0.1, bottom: 0.1 } },
        timeScale: { borderColor: "#232938", timeVisible: false },
        crosshair: { mode: 0 },
        handleScroll: false,
        handleScale: false,
      })

      for (const s of series) {
        if (s.type === "line") {
          const ls = chart.addSeries(lc.LineSeries, {
            color: s.color,
            lineWidth: s.width ?? 1,
            priceLineVisible: false,
            lastValueVisible: false,
          })
          ls.setData(s.data as { time: import("lightweight-charts").Time; value: number }[])
        } else if (s.type === "histogram") {
          const hs = chart.addSeries(lc.HistogramSeries, {
            color: s.color ?? "#60a5fa",
            priceLineVisible: false,
            lastValueVisible: false,
          })
          hs.setData(s.data as { time: import("lightweight-charts").Time; value: number; color?: string }[])
        }
      }

      chart.timeScale().fitContent()
    })

    return () => { chart?.remove() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series.length])

  return <div ref={ref} className="w-full" style={{ height }} />
}

// ── Stat row ──────────────────────────────────────────────────────────────────

function StatRow({ row }: { row: StatRowSpec }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground/50">{row.label}</span>
      <span className={cn("font-mono font-medium", row.className)}>{row.value}</span>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function QuantPage() {
  const [data, setData] = useState<QuantResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ModelId>("linear_regression")

  const load = useCallback(async (method: "GET" | "POST" = "GET") => {
    method === "GET" ? setLoading(true) : setRefreshing(true)
    setError(null)
    try {
      const r = await fetch(withBase("/api/quant"), { method, credentials: "include" })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setData(await r.json())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load quant data")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const selSpec = getSpec(selected)
  const modelData = data ? (data[selected] as Record<string, unknown> | undefined) : undefined
  const hasError = modelData && "error" in modelData
  const chartSeries: ChartSeries[] = data && modelData && !hasError
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? selSpec.series(modelData as any)
    : []
  const statRows: StatRowSpec[] = data && modelData && !hasError
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? selSpec.stats(modelData as any)
    : []

  return (
    <div className="flex flex-col h-full gap-0 -m-4 lg:-m-6">
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/30 bg-card/80 px-4 backdrop-blur-md">
        <FlaskConical className="h-4 w-4 text-muted-foreground/50" />
        <span className="text-sm font-medium">Quant Models</span>
        {data && (
          <span className="text-xs text-muted-foreground/30">
            — {data.price_date}
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={() => load("POST")}
          disabled={refreshing || loading}
          className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent/30 rounded transition-colors"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          Recompute
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-muted-foreground/40">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm">Running {MODEL_SPECS.length} quant models…</p>
          <p className="text-xs">First run takes ~15 seconds</p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-rose-400/70">
          <AlertCircle className="h-8 w-8" />
          <p className="text-sm">{error}</p>
          <button onClick={() => load()} className="text-xs underline text-muted-foreground/50 hover:text-muted-foreground">
            Retry
          </button>
        </div>
      ) : data ? (
        <div className="flex flex-1 min-h-0">

          {/* ── Sidebar: model list ── */}
          <div className="w-52 shrink-0 border-r border-border/30 overflow-y-auto bg-card/20">
            {/* Summary strip */}
            <div className="border-b border-border/20 px-3 py-3 space-y-1.5">
              <div className="text-[10px] text-muted-foreground/40 uppercase tracking-wider">BTC Summary</div>
              <div className="text-lg font-bold text-orange-400">{fmtPrice(data.price_current)}</div>
              {data.hmm && !("error" in data.hmm) && (
                <div className={cn("text-xs font-medium", regimeColor(data.hmm.current_regime_class))}>
                  {data.hmm.current_regime_label} regime
                </div>
              )}
              {data.garch && !("error" in data.garch) && data.garch.current_vol_annualized != null && (
                <div className="text-xs text-muted-foreground/50">
                  Vol: {(data.garch.current_vol_annualized * 100).toFixed(0)}% ann.
                </div>
              )}
            </div>

            {/* Model buttons */}
            <div className="py-1">
              {MODEL_SPECS.map((m) => {
                const Icon = m.icon
                const md = data[m.id as ModelId] as Record<string, unknown> | undefined
                const err = md && "error" in md
                return (
                  <button
                    key={m.id}
                    onClick={() => setSelected(m.id)}
                    className={cn(
                      "flex items-start gap-2.5 w-full px-3 py-2.5 text-left transition-colors",
                      selected === m.id
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/30 hover:text-foreground"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 mt-0.5 opacity-60" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{m.label}</div>
                      <div className={cn("text-[10px] opacity-50", err && "text-rose-400")}>
                        {err ? "error" : m.category}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* ── Detail panel ── */}
          <div className="flex-1 min-w-0 overflow-y-auto">
            {/* Model header */}
            <div className="border-b border-border/20 px-6 py-4 bg-card/20">
              <div className="flex items-start gap-3">
                <selSpec.icon className="h-5 w-5 shrink-0 mt-0.5 text-muted-foreground/50" />
                <div>
                  <h2 className="text-base font-semibold">{selSpec.label}</h2>
                  <p className="text-xs text-muted-foreground/50 mt-0.5">{selSpec.desc}</p>
                </div>
                <span className="ml-auto text-[10px] px-2 py-0.5 rounded border border-border/30 text-muted-foreground/40">
                  {selSpec.category}
                </span>
              </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-0 min-h-0">
              {/* Chart */}
              <div className="flex-1 min-w-0 p-4 border-b lg:border-b-0 lg:border-r border-border/20">
                {hasError ? (
                  <div className="flex items-center gap-2 text-rose-400/70 text-sm p-4">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {String(modelData!.error)}
                  </div>
                ) : chartSeries.length ? (
                  <div className="rounded-lg border border-border/20 bg-card/30 overflow-hidden">
                    <MiniChart series={chartSeries} height={280} />
                  </div>
                ) : null}

                {/* Legend (from spec) */}
                {!hasError && selSpec.legend.length > 0 && (
                  <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground/40 flex-wrap">
                    {selSpec.legend.map((item) => (
                      <span key={item.label} className="flex items-center gap-1.5">
                        <span className="inline-block w-3 h-0.5" style={{ backgroundColor: item.color }} />
                        {item.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Stats */}
              <div className="w-full lg:w-56 shrink-0 p-4 space-y-2">
                <div className="text-[10px] text-muted-foreground/40 uppercase tracking-wider mb-3">Statistics</div>
                {!hasError && statRows.map((row, i) => <StatRow key={i} row={row} />)}
                {!hasError && selSpec.footer && (
                  <div className="pt-2 text-xs text-muted-foreground/40">{selSpec.footer}</div>
                )}
                <div className="pt-3 border-t border-border/20 text-[10px] text-muted-foreground/30 space-y-1">
                  <div>Data: {data.data_points} daily closes</div>
                  <div>Source: BTC-USD (yfinance)</div>
                  <div>Updated: {new Date(data.generated_at).toLocaleTimeString()}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
