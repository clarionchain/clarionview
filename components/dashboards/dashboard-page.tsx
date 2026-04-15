"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { ExternalLink, Loader2, TrendingUp, TrendingDown, AlertCircle } from "lucide-react"
import { withBase } from "@/lib/base-path"
import { formatValue } from "@/lib/workbench-types"
import { cn } from "@/lib/utils"
import type { IChartApi } from "lightweight-charts"

// Lazy-import lightweight-charts (browser-only)
let createChart: typeof import("lightweight-charts").createChart | null = null
let LineSeries: typeof import("lightweight-charts").LineSeries | null = null

interface TickerDef {
  seriesName: string          // e.g. "yf:IBIT" or "fred:FEDFUNDS"
  label: string               // human display name
  color: string
  axis?: "left" | "right"    // default "right"; "left" = raw price, not normalized
}

interface SeriesDataPoint {
  time: string
  value: number
}

interface TickerState {
  data: SeriesDataPoint[]
  loading: boolean
  error: string | null
}

export interface DashboardPageProps {
  title: string
  description: string
  tickers: TickerDef[]
  /** Workbook template id to open when user clicks "Open in Workbench" */
  templateId: string
  /** Exclude tickers with this axis value from the stats table */
  excludeAxisFromStats?: "left" | "right"
  /**
   * ISO date (YYYY-MM-DD) to clip all right-axis series from.
   * When set, right-axis series show % return since this date (0% = start).
   * Useful when series have very different inception dates (e.g. GBTC 2015 vs IBIT 2024).
   */
  clipFromDate?: string
}

function pctChange(data: SeriesDataPoint[], days: number): number | null {
  if (data.length < 2) return null
  const last = data[data.length - 1].value
  const lookback = data[Math.max(0, data.length - 1 - days)]?.value
  if (!lookback || lookback === 0) return null
  return ((last / lookback) - 1) * 100
}

function PctBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground/40 text-xs">—</span>
  const pos = value >= 0
  return (
    <span className={cn("flex items-center gap-0.5 text-xs font-mono tabular-nums", pos ? "text-emerald-400" : "text-rose-400")}>
      {pos ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {pos ? "+" : ""}{value.toFixed(2)}%
    </span>
  )
}

function fmtPct(v: number) {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`
}

function ReturnBarChart({ tickers, states, clipFromDate }: {
  tickers: TickerDef[]
  states: Record<string, TickerState>
  clipFromDate?: string
}) {
  const entries = tickers
    .filter((t) => t.axis !== "left")
    .flatMap((t) => {
      const raw = states[t.seriesName]?.data ?? []
      const source = clipFromDate ? raw.filter((d) => d.time >= clipFromDate) : raw
      if (source.length < 2) return []
      const base = source[0].value
      const last = source[source.length - 1].value
      if (!base) return []
      return [{ ticker: t, pct: ((last / base) - 1) * 100 }]
    })
    .sort((a, b) => b.pct - a.pct)

  if (entries.length === 0) return null

  const maxAbs = Math.max(...entries.map((e) => Math.abs(e.pct)))

  return (
    <div className="border-l border-border/20 px-4 py-3 flex flex-col w-52 shrink-0">
      <div className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider mb-2.5">
        Total Return
      </div>
      <div className="flex flex-col gap-2 justify-center flex-1">
        {entries.map(({ ticker, pct }) => {
          const symbol = ticker.seriesName.split(":")[1] ?? ticker.seriesName
          const barW = maxAbs > 0 ? (Math.abs(pct) / maxAbs) * 100 : 0
          const positive = pct >= 0
          return (
            <div key={ticker.seriesName} className="flex items-center gap-2">
              <div className="text-[10px] font-mono text-muted-foreground/50 w-9 shrink-0 text-right">{symbol}</div>
              <div className="flex-1 h-3 bg-white/5 rounded-sm overflow-hidden">
                <div
                  className="h-full rounded-sm transition-all"
                  style={{ width: `${barW}%`, backgroundColor: ticker.color }}
                />
              </div>
              <div
                className="text-[10px] font-mono tabular-nums w-12 shrink-0 text-right"
                style={{ color: positive ? "#34d399" : "#f87171" }}
              >
                {fmtPct(pct)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function DashboardPage({ title, description, tickers, templateId, excludeAxisFromStats, clipFromDate }: DashboardPageProps) {
  const [states, setStates] = useState<Record<string, TickerState>>(
    Object.fromEntries(tickers.map((t) => [t.seriesName, { data: [], loading: true, error: null }]))
  )

  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesRefs = useRef<Map<string, any>>(new Map())

  // Fetch all ticker data
  useEffect(() => {
    for (const ticker of tickers) {
      const url = withBase(`/api/workbench/series?name=${encodeURIComponent(ticker.seriesName)}`)
      fetch(url, { credentials: "include" })
        .then((r) => {
          if (!r.ok) return r.json().then((b) => Promise.reject(new Error(b?.error || `HTTP ${r.status}`)))
          return r.json()
        })
        .then(({ data }: { data: SeriesDataPoint[] }) => {
          setStates((prev) => ({
            ...prev,
            [ticker.seriesName]: { data, loading: false, error: null },
          }))
        })
        .catch((e: Error) => {
          setStates((prev) => ({
            ...prev,
            [ticker.seriesName]: { data: [], loading: false, error: e.message },
          }))
        })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Build/update chart when data is ready
  useEffect(() => {
    const anyLoading = tickers.some((t) => states[t.seriesName]?.loading)
    if (anyLoading || !chartContainerRef.current) return

    const init = async () => {
      if (!createChart || !LineSeries) {
        const mod = await import("lightweight-charts")
        createChart = mod.createChart
        LineSeries = mod.LineSeries
      }

      const container = chartContainerRef.current!
      const hasLeftAxis = tickers.some((t) => t.axis === "left")

      if (!chartRef.current) {
        chartRef.current = createChart(container, {
          layout: { background: { color: "transparent" }, textColor: "#9ca3af" },
          grid: { vertLines: { color: "#1f2937" }, horzLines: { color: "#1f2937" } },
          rightPriceScale: { borderColor: "#374151" },
          leftPriceScale: { visible: hasLeftAxis, borderColor: "#374151" },
          timeScale: { borderColor: "#374151", timeVisible: false },
          width: container.clientWidth,
          height: 320,
        })
      } else if (hasLeftAxis) {
        chartRef.current.applyOptions({ leftPriceScale: { visible: true } })
      }

      const chart = chartRef.current

      const allData = tickers.map((t) => states[t.seriesName]?.data ?? []).filter((d) => d.length > 0)
      if (allData.length === 0) return

      for (const ticker of tickers) {
        const raw = states[ticker.seriesName]?.data
        if (!raw || raw.length === 0) continue

        const isLeft = ticker.axis === "left"

        let displayData: { time: `${number}-${number}-${number}`; value: number }[]

        if (isLeft) {
          // Left axis: raw price values
          displayData = raw.map((d) => ({ time: d.time as `${number}-${number}-${number}`, value: d.value }))
        } else {
          // Right axis: % return from clipFromDate (or series start if no clip)
          const source = clipFromDate ? raw.filter((d) => d.time >= clipFromDate) : raw
          if (source.length === 0) continue
          const base = source[0].value
          if (base === 0) continue
          displayData = source.map((d) => ({
            time: d.time as `${number}-${number}-${number}`,
            value: ((d.value / base) - 1) * 100,
          }))
        }

        let lineSeries = seriesRefs.current.get(ticker.seriesName)
        if (!lineSeries) {
          lineSeries = chart.addSeries(LineSeries!, {
            color: ticker.color,
            lineWidth: isLeft ? 1 : 2,
            title: ticker.label,
            priceLineVisible: false,
            lastValueVisible: !isLeft,
            priceScaleId: isLeft ? "left" : "right",
            ...(!isLeft && {
              priceFormat: {
                type: "custom" as const,
                formatter: fmtPct,
                minMove: 0.1,
              },
            }),
          })
          seriesRefs.current.set(ticker.seriesName, lineSeries)
        }
        lineSeries.setData(displayData)
      }

      chart.timeScale().fitContent()
    }

    init().catch(console.error)
  }, [states, tickers, clipFromDate])

  // Resize observer
  useEffect(() => {
    if (!chartContainerRef.current) return
    const ro = new ResizeObserver(() => {
      chartRef.current?.applyOptions({ width: chartContainerRef.current!.clientWidth })
    })
    ro.observe(chartContainerRef.current)
    return () => ro.disconnect()
  }, [])

  // Cleanup chart on unmount
  useEffect(() => {
    return () => {
      chartRef.current?.remove()
      chartRef.current = null
      seriesRefs.current.clear()
    }
  }, [])

  const openInWorkbench = useCallback(() => {
    try { sessionStorage.setItem("load_template", templateId) } catch { /* ignore */ }
    window.location.href = withBase("/")
  }, [templateId])

  const anyLoading = tickers.some((t) => states[t.seriesName]?.loading)
  const hasLeftAxis = tickers.some((t) => t.axis === "left")

  // Build chart subtitle
  let chartSubtitle: string
  if (hasLeftAxis) {
    if (clipFromDate) {
      chartSubtitle = `% return since ${clipFromDate} (right axis) · BTC price USD (left axis)`
    } else {
      chartSubtitle = "% return from series start (right axis) · BTC price USD (left axis)"
    }
  } else {
    chartSubtitle = clipFromDate
      ? `% return since ${clipFromDate}`
      : "% return from series start"
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground/70">{description}</p>
        </div>
        <button
          onClick={openInWorkbench}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border/50 text-muted-foreground hover:text-foreground hover:border-border transition-colors shrink-0"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open in Workbench
        </button>
      </div>

      {/* Comparison chart + return bar chart */}
      <div className="rounded-lg border border-border/30 bg-card/40 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border/20 flex items-center gap-2">
          <span className="text-xs text-muted-foreground/60 font-medium">{chartSubtitle}</span>
          {anyLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/40" />}
        </div>
        <div className="flex">
          <div className="flex-1 min-w-0 px-2 pt-2">
            <div ref={chartContainerRef} className="w-full" style={{ minHeight: 320 }} />
          </div>
          {!anyLoading && clipFromDate && (
            <ReturnBarChart tickers={tickers} states={states} clipFromDate={clipFromDate} />
          )}
        </div>
        {/* Legend */}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-4 pb-3 pt-1">
          {tickers.map((t) => (
            <div key={t.seriesName} className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
              <span className="h-2 w-4 rounded-full inline-block shrink-0" style={{ backgroundColor: t.color }} />
              {t.label}
            </div>
          ))}
        </div>
      </div>

      {/* Stats table */}
      <div className="rounded-lg border border-border/30 bg-card/40 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/20">
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground/60">Instrument</th>
              <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground/60">Current</th>
              <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground/60">1D</th>
              <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground/60">7D</th>
              <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground/60">30D</th>
              <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground/60">1Y</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {(excludeAxisFromStats ? tickers.filter((t) => t.axis !== excludeAxisFromStats) : tickers).map((ticker) => {
              const state = states[ticker.seriesName]
              const last = state?.data?.[state.data.length - 1]?.value ?? null
              return (
                <tr key={ticker.seriesName} className="border-b border-border/10 hover:bg-accent/10 transition-colors">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: ticker.color }} />
                      <div>
                        <div className="font-medium text-foreground text-sm">{ticker.label}</div>
                        <div className="text-[10px] text-muted-foreground/40 font-mono">{ticker.seriesName}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-foreground">
                    {state?.loading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/40 ml-auto" />
                    ) : state?.error ? (
                      <span className="flex items-center gap-1 justify-end text-xs text-rose-400/70" title={state.error}>
                        <AlertCircle className="h-3 w-3" />
                        Error
                      </span>
                    ) : last !== null ? (
                      formatValue(last)
                    ) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right"><PctBadge value={state?.data ? pctChange(state.data, 1) : null} /></td>
                  <td className="px-4 py-2.5 text-right"><PctBadge value={state?.data ? pctChange(state.data, 7) : null} /></td>
                  <td className="px-4 py-2.5 text-right"><PctBadge value={state?.data ? pctChange(state.data, 30) : null} /></td>
                  <td className="px-4 py-2.5 text-right"><PctBadge value={state?.data ? pctChange(state.data, 365) : null} /></td>
                  <td className="px-3 py-2.5">
                    <button
                      onClick={() => {
                        try { sessionStorage.setItem("add_series", JSON.stringify({ name: ticker.seriesName, display: ticker.label })) } catch { /* ignore */ }
                        window.location.href = withBase("/")
                      }}
                      className="text-[10px] px-2 py-0.5 rounded border border-border/30 text-muted-foreground/50 hover:text-foreground hover:border-border/60 transition-colors"
                      title="Add to workbench"
                    >
                      + Add
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
