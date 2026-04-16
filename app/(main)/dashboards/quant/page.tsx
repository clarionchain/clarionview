"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import {
  FlaskConical, Loader2, RefreshCw, AlertCircle, TrendingUp, TrendingDown,
  Activity, Brain, BarChart2, GitBranch, Waves, Sigma, Network,
} from "lucide-react"
import { withBase } from "@/lib/base-path"
import { cn } from "@/lib/utils"

// ── Types ─────────────────────────────────────────────────────────────────────

interface DataPoint { time: string; value: number; color?: string }

interface QuantResult {
  generated_at: string
  price_current: number
  price_date: string
  data_points: number
  linear_regression?: {
    price: DataPoint[]; trend: DataPoint[]; forecast: DataPoint[]
    r2: number; daily_growth_pct: number; current_deviation_pct: number
    current_price: number; current_trend: number; above_trend: boolean
  }
  garch?: {
    volatility: DataPoint[]
    current_vol_annualized: number; long_run_vol_annualized: number
    forecast_30d_vol: number; alpha: number; beta: number
    persistence: number; vol_regime: string
  }
  monte_carlo?: {
    current_price: number; days: number; simulations: number
    percentiles: Record<string, DataPoint[]>
    prob_above_current: number; expected_return_pct: number
    p5_final: number; p50_final: number; p95_final: number
  }
  kalman?: {
    price: DataPoint[]; trend: DataPoint[]
    current_trend_value: number; current_slope: number
    trend_label: string; current_price: number
  }
  hmm?: {
    regimes: (DataPoint & { state: number })[]
    current_regime: number; current_regime_label: string
    current_regime_class: string; current_regime_probability: number
    n_states: number
  }
  arima?: {
    price: DataPoint[]; forecast: DataPoint[]; lower: DataPoint[]; upper: DataPoint[]
    steps: number; current_price: number; forecast_14d: number; change_pct: number
  }
  neural_network?: {
    signal: DataPoint[]
    current_probability_up: number; signal_label: string
    test_accuracy: number; n_train: number; n_test: number; architecture: string
  }
}

// ── Model metadata ────────────────────────────────────────────────────────────

const MODELS = [
  {
    id: "linear_regression",
    label: "Linear Regression",
    category: "Price Modeling",
    icon: TrendingUp,
    desc: "Log-linear OLS trend line. Shows where price sits relative to its long-run trajectory.",
  },
  {
    id: "garch",
    label: "GARCH(1,1)",
    category: "Volatility Modeling",
    icon: Activity,
    desc: "Conditional heteroskedasticity model. Captures volatility clustering and forecasts risk.",
  },
  {
    id: "monte_carlo",
    label: "Monte Carlo",
    category: "Scenario Simulation",
    icon: GitBranch,
    desc: "500 GBM price paths over 90 days. Models uncertainty and estimates return distribution.",
  },
  {
    id: "kalman",
    label: "Kalman Filter",
    category: "Signal Extraction",
    icon: Waves,
    desc: "Adaptive trend estimator. Continuously updates hidden trend state from noisy price data.",
  },
  {
    id: "hmm",
    label: "Hidden Markov",
    category: "Regime Switching",
    icon: Network,
    desc: "3-state Gaussian HMM. Infers unobservable bull/neutral/bear market regimes.",
  },
  {
    id: "arima",
    label: "ARIMA(2,1,2)",
    category: "Time Series",
    icon: BarChart2,
    desc: "Autoregressive integrated moving-average model with 14-day price forecast and 80% CI.",
  },
  {
    id: "neural_network",
    label: "Neural Network",
    category: "Deep Learning",
    icon: Brain,
    desc: "MLP(20→32→1) trained on normalized return windows. Outputs P(next-day return > 0).",
  },
] as const

type ModelId = (typeof MODELS)[number]["id"]

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtPrice(v: number | null | undefined) {
  if (v == null || !isFinite(v)) return "—"
  return "$" + v.toLocaleString(undefined, { maximumFractionDigits: 0 })
}
function fmtNum(v: number | null | undefined, opts?: Intl.NumberFormatOptions) {
  if (v == null || !isFinite(v)) return "—"
  return v.toLocaleString(undefined, opts)
}
function fmtPct(v: number | null | undefined, decimals = 1) {
  if (v == null || !isFinite(v)) return "—"
  return (v >= 0 ? "+" : "") + v.toFixed(decimals) + "%"
}

function regimeColor(cls: string) {
  if (cls === "bullish") return "text-emerald-400"
  if (cls === "bearish") return "text-rose-400"
  return "text-amber-400"
}

// ── Mini chart using lightweight-charts ──────────────────────────────────────

type ChartSeries =
  | { type: "line"; data: DataPoint[]; color: string; width?: 1 | 2 | 3 | 4 }
  | { type: "histogram"; data: DataPoint[]; color?: string }

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

// ── Model stat cards ──────────────────────────────────────────────────────────

function StatRow({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground/50">{label}</span>
      <span className={cn("font-mono font-medium", className)}>{value}</span>
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

  // ── Chart series builders ─────────────────────────────────────────────────

  function buildSeries(id: ModelId): ChartSeries[] {
    if (!data) return []
    const ORANGE = "#f7931a"
    const CYAN = "#22d3ee"
    const EMERALD = "#34d399"
    const ROSE = "#fb4b4b"
    const AMBER = "#fbbf24"
    const MUTED = "#78829680"

    switch (id) {
      case "linear_regression": {
        const m = data.linear_regression
        if (!m) return []
        return [
          { type: "line", data: m.price, color: ORANGE, width: 1 },
          { type: "line", data: m.trend, color: CYAN, width: 1 },
          { type: "line", data: m.forecast, color: CYAN + "80", width: 1 },
        ]
      }
      case "garch": {
        const m = data.garch
        if (!m) return []
        return [{ type: "line", data: m.volatility, color: AMBER, width: 1 }]
      }
      case "monte_carlo": {
        const m = data.monte_carlo
        if (!m) return []
        return [
          { type: "line", data: m.percentiles.p95, color: ROSE + "60", width: 1 },
          { type: "line", data: m.percentiles.p75, color: ROSE + "90", width: 1 },
          { type: "line", data: m.percentiles.p50, color: ORANGE, width: 2 },
          { type: "line", data: m.percentiles.p25, color: EMERALD + "90", width: 1 },
          { type: "line", data: m.percentiles.p5, color: EMERALD + "60", width: 1 },
        ]
      }
      case "kalman": {
        const m = data.kalman
        if (!m) return []
        return [
          { type: "line", data: m.price, color: ORANGE, width: 1 },
          { type: "line", data: m.trend, color: CYAN, width: 2 },
        ]
      }
      case "hmm": {
        const m = data.hmm
        if (!m) return []
        // Show regime as colored histogram bars (value=1, color by state)
        const bars = m.regimes.map((pt) => ({
          time: pt.time,
          value: 1,
          color: pt.state === 2 ? EMERALD + "80" : pt.state === 0 ? ROSE + "80" : MUTED,
        }))
        return [{ type: "histogram", data: bars }]
      }
      case "arima": {
        const m = data.arima
        if (!m) return []
        return [
          { type: "line", data: m.price, color: ORANGE, width: 1 },
          { type: "line", data: m.upper, color: CYAN + "50", width: 1 },
          { type: "line", data: m.forecast, color: CYAN, width: 2 },
          { type: "line", data: m.lower, color: CYAN + "50", width: 1 },
        ]
      }
      case "neural_network": {
        const m = data.neural_network
        if (!m) return []
        return [{ type: "line", data: m.signal, color: EMERALD, width: 1 }]
      }
      default:
        return []
    }
  }

  function renderStats(id: ModelId) {
    if (!data) return null
    switch (id) {
      case "linear_regression": {
        const m = data.linear_regression
        if (!m) return null
        return (
          <>
            <StatRow label="R²" value={m.r2.toFixed(4)} />
            <StatRow label="Current price" value={fmtPrice(m.current_price)} />
            <StatRow label="Trend price" value={fmtPrice(m.current_trend)} />
            <StatRow
              label="Deviation"
              value={fmtPct(m.current_deviation_pct)}
              className={m.above_trend ? "text-rose-400" : "text-emerald-400"}
            />
            <StatRow label="Daily trend growth" value={m.daily_growth_pct.toFixed(4) + "%"} />
            <StatRow label="30d forecast" value={fmtPrice(m.forecast.at(-1)?.value ?? 0)} />
          </>
        )
      }
      case "garch": {
        const m = data.garch
        if (!m) return null
        const regCls = m.vol_regime === "elevated" ? "text-rose-400" : m.vol_regime === "low" ? "text-emerald-400" : "text-amber-400"
        return (
          <>
            <StatRow label="Current vol (ann.)" value={(m.current_vol_annualized * 100).toFixed(1) + "%"} className="text-amber-400" />
            <StatRow label="Long-run vol" value={(m.long_run_vol_annualized * 100).toFixed(1) + "%"} />
            <StatRow label="30d vol forecast" value={(m.forecast_30d_vol * 100).toFixed(1) + "%"} />
            <StatRow label="α (shock)" value={m.alpha.toFixed(4)} />
            <StatRow label="β (persistence)" value={m.beta.toFixed(4)} />
            <StatRow label="α+β" value={m.persistence.toFixed(4)} />
            <StatRow label="Regime" value={m.vol_regime} className={regCls} />
          </>
        )
      }
      case "monte_carlo": {
        const m = data.monte_carlo
        if (!m) return null
        return (
          <>
            <StatRow label="Current price" value={fmtPrice(m.current_price)} />
            <StatRow label="Simulations" value={fmtNum(m.simulations)} />
            <StatRow label="Horizon" value={`${m.days} days`} />
            <StatRow label="P(above current)" value={(m.prob_above_current * 100).toFixed(1) + "%"}
              className={m.prob_above_current > 0.5 ? "text-emerald-400" : "text-rose-400"} />
            <StatRow label="Expected return" value={fmtPct(m.expected_return_pct)}
              className={m.expected_return_pct >= 0 ? "text-emerald-400" : "text-rose-400"} />
            <StatRow label="P5 / P50 / P95" value={`${fmtPrice(m.p5_final)} / ${fmtPrice(m.p50_final)} / ${fmtPrice(m.p95_final)}`} />
          </>
        )
      }
      case "kalman": {
        const m = data.kalman
        if (!m) return null
        return (
          <>
            <StatRow label="Current price" value={fmtPrice(m.current_price)} />
            <StatRow label="Kalman trend" value={fmtPrice(m.current_trend_value)} />
            <StatRow label="Slope ($/day)" value={"$" + fmtNum(m.current_slope, { maximumFractionDigits: 0 })} />
            <StatRow label="Trend direction" value={m.trend_label}
              className={m.trend_label === "bullish" ? "text-emerald-400" : "text-rose-400"} />
            <StatRow label="Price vs trend"
              value={fmtPct((m.current_price / m.current_trend_value - 1) * 100)}
              className={m.current_price > m.current_trend_value ? "text-rose-400" : "text-emerald-400"} />
          </>
        )
      }
      case "hmm": {
        const m = data.hmm
        if (!m) return null
        const cls = regimeColor(m.current_regime_class)
        return (
          <>
            <StatRow label="Current regime" value={m.current_regime_label} className={cls} />
            <StatRow label="Confidence" value={(m.current_regime_probability * 100).toFixed(1) + "%"} />
            <StatRow label="States" value={`${m.n_states} (Bear / Neutral / Bull)`} />
            <div className="pt-2 text-xs text-muted-foreground/40">
              Green = Bull · Grey = Neutral · Red = Bear
            </div>
          </>
        )
      }
      case "arima": {
        const m = data.arima
        if (!m) return null
        return (
          <>
            <StatRow label="Current price" value={fmtPrice(m.current_price)} />
            <StatRow label="14d forecast" value={fmtPrice(m.forecast_14d)} />
            <StatRow label="Forecast change" value={fmtPct(m.change_pct)}
              className={m.change_pct >= 0 ? "text-emerald-400" : "text-rose-400"} />
            <StatRow label="Order" value="ARIMA(2,1,2)" />
            <StatRow label="CI" value="80%" />
            <StatRow label="Horizon" value={`${m.steps} days`} />
          </>
        )
      }
      case "neural_network": {
        const m = data.neural_network
        if (!m) return null
        const pctUp = (m.current_probability_up * 100).toFixed(1)
        const cls = m.signal_label === "bullish" ? "text-emerald-400" : m.signal_label === "bearish" ? "text-rose-400" : "text-amber-400"
        return (
          <>
            <StatRow label="P(up tomorrow)" value={pctUp + "%"} className={cls} />
            <StatRow label="Signal" value={m.signal_label} className={cls} />
            <StatRow label="Test accuracy" value={(m.test_accuracy * 100).toFixed(1) + "%"} />
            <StatRow label="Training samples" value={fmtNum(m.n_train)} />
            <StatRow label="Test samples" value={fmtNum(m.n_test)} />
            <StatRow label="Architecture" value={m.architecture} />
          </>
        )
      }
      default:
        return null
    }
  }

  const selModel = MODELS.find((m) => m.id === selected)!
  const chartSeries = buildSeries(selected)

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
          <p className="text-sm">Running 7 quant models…</p>
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
              {data.garch && !("error" in data.garch) && (
                <div className="text-xs text-muted-foreground/50">
                  Vol: {(data.garch.current_vol_annualized * 100).toFixed(0)}% ann.
                </div>
              )}
            </div>

            {/* Model buttons */}
            <div className="py-1">
              {MODELS.map((m) => {
                const Icon = m.icon
                const modelData = data[m.id as ModelId] as Record<string, unknown> | undefined
                const hasError = modelData && "error" in modelData
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
                      <div className={cn("text-[10px] opacity-50", hasError && "text-rose-400")}>
                        {hasError ? "error" : m.category}
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
                <selModel.icon className="h-5 w-5 shrink-0 mt-0.5 text-muted-foreground/50" />
                <div>
                  <h2 className="text-base font-semibold">{selModel.label}</h2>
                  <p className="text-xs text-muted-foreground/50 mt-0.5">{selModel.desc}</p>
                </div>
                <span className="ml-auto text-[10px] px-2 py-0.5 rounded border border-border/30 text-muted-foreground/40">
                  {selModel.category}
                </span>
              </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-0 min-h-0">
              {/* Chart */}
              <div className="flex-1 min-w-0 p-4 border-b lg:border-b-0 lg:border-r border-border/20">
                {(() => {
                  const modelData = data[selected] as Record<string, unknown> | undefined
                  if (modelData && "error" in modelData) {
                    return (
                      <div className="flex items-center gap-2 text-rose-400/70 text-sm p-4">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        {String(modelData.error)}
                      </div>
                    )
                  }
                  if (!chartSeries.length) return null
                  return (
                    <div className="rounded-lg border border-border/20 bg-card/30 overflow-hidden">
                      <MiniChart series={chartSeries} height={280} />
                    </div>
                  )
                })()}

                {/* Legend */}
                {selected === "linear_regression" && (
                  <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground/40">
                    <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-orange-400" />Price</span>
                    <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-cyan-400" />Trend</span>
                    <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-cyan-400/50" />30d forecast</span>
                  </div>
                )}
                {selected === "kalman" && (
                  <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground/40">
                    <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-orange-400" />Price</span>
                    <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-cyan-400" />Kalman trend</span>
                  </div>
                )}
                {selected === "monte_carlo" && (
                  <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground/40 flex-wrap">
                    <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-rose-400/60" />P5/P95</span>
                    <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-rose-400" />P25/P75</span>
                    <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-orange-400" />Median (P50)</span>
                    <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-emerald-400" />P25/P75 down</span>
                  </div>
                )}
                {selected === "arima" && (
                  <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground/40">
                    <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-orange-400" />Price</span>
                    <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-cyan-400" />Forecast</span>
                    <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-cyan-400/50" />80% CI</span>
                  </div>
                )}
                {selected === "neural_network" && (
                  <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground/40">
                    <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-emerald-400" />P(up) signal — 0.5 = neutral</span>
                  </div>
                )}
              </div>

              {/* Stats */}
              <div className="w-full lg:w-56 shrink-0 p-4 space-y-2">
                <div className="text-[10px] text-muted-foreground/40 uppercase tracking-wider mb-3">Statistics</div>
                {renderStats(selected)}
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
