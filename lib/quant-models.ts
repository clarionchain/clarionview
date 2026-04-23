import type { ComponentType, ReactNode } from "react"
import {
  TrendingUp, Activity, GitBranch, Waves, Sigma, Network, Brain, BarChart2,
} from "lucide-react"

// ── Shared types ──────────────────────────────────────────────────────────────

export type DataPoint = { time: string; value: number; color?: string }

export type ChartSeries =
  | { type: "line"; data: DataPoint[]; color: string; width?: 1 | 2 | 3 | 4 }
  | { type: "histogram"; data: DataPoint[]; color?: string }

export type LegendItem = { label: string; color: string }

export type StatRow = { label: string; value: ReactNode; className?: string }

// ── Per-model payload shapes (mirrors backend /api/quant response) ────────────

export type LinearRegressionPayload = {
  price: DataPoint[]; trend: DataPoint[]; forecast: DataPoint[]
  r2: number; daily_growth_pct: number; current_deviation_pct: number
  current_price: number; current_trend: number; above_trend: boolean
}

export type GarchPayload = {
  volatility: DataPoint[]
  current_vol_annualized: number; long_run_vol_annualized: number
  forecast_30d_vol: number; alpha: number; beta: number
  persistence: number; vol_regime: string
}

export type MonteCarloPayload = {
  current_price: number; days: number; simulations: number
  percentiles: Record<string, DataPoint[]>
  prob_above_current: number; expected_return_pct: number
  p5_final: number; p50_final: number; p95_final: number
}

export type KalmanPayload = {
  price: DataPoint[]; trend: DataPoint[]
  current_trend_value: number; current_slope: number
  trend_label: string; current_price: number
}

export type HmmPayload = {
  regimes: (DataPoint & { state: number })[]
  current_regime: number; current_regime_label: string
  current_regime_class: string; current_regime_probability: number
  n_states: number
}

export type ArimaPayload = {
  price: DataPoint[]; forecast: DataPoint[]; lower: DataPoint[]; upper: DataPoint[]
  steps: number; current_price: number; forecast_14d: number; change_pct: number
}

export type NeuralNetworkPayload = {
  signal: DataPoint[]
  current_probability_up: number; signal_label: string
  test_accuracy: number; n_train: number; n_test: number; architecture: string
}

export type ChronosPayload = {
  price: DataPoint[]; forecast: DataPoint[]; lower: DataPoint[]; upper: DataPoint[]
  current_price: number; forecast_90d: number; change_pct: number
  horizon_days: number; context_points: number
}

// Backwards compat: backend still emits these under key "timesfm"
export type QuantResult = {
  generated_at: string
  price_current: number
  price_date: string
  data_points: number
  linear_regression?: LinearRegressionPayload
  garch?: GarchPayload
  monte_carlo?: MonteCarloPayload
  kalman?: KalmanPayload
  hmm?: HmmPayload
  arima?: ArimaPayload
  neural_network?: NeuralNetworkPayload
  timesfm?: ChronosPayload
}

// ── Chart palette (single source of truth) ────────────────────────────────────

export const COLORS = {
  ORANGE: "#f7931a",
  CYAN: "#22d3ee",
  EMERALD: "#34d399",
  ROSE: "#fb4b4b",
  AMBER: "#fbbf24",
  MUTED: "#78829680",
} as const

// ── Formatters ────────────────────────────────────────────────────────────────

export function fmtPrice(v: number | null | undefined) {
  if (v == null || !isFinite(v)) return "—"
  return "$" + v.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

export function fmtNum(v: number | null | undefined, opts?: Intl.NumberFormatOptions) {
  if (v == null || !isFinite(v)) return "—"
  return v.toLocaleString(undefined, opts)
}

export function fmtPct(v: number | null | undefined, decimals = 1) {
  if (v == null || !isFinite(v)) return "—"
  return (v >= 0 ? "+" : "") + v.toFixed(decimals) + "%"
}

export function regimeColor(cls: string) {
  if (cls === "bullish") return "text-emerald-400"
  if (cls === "bearish") return "text-rose-400"
  return "text-amber-400"
}

// ── Model spec ────────────────────────────────────────────────────────────────

export type ModelSpec<K extends keyof QuantResult, P> = {
  id: K
  label: string
  category: string
  icon: ComponentType<{ className?: string }>
  desc: string
  series: (m: P) => ChartSeries[]
  stats: (m: P) => StatRow[]
  legend: LegendItem[]
  footer?: string
}

// Each spec is the *complete* definition for a model — add/remove/edit one
// model by editing one object. Adding a new model: add a payload type above,
// add a key to QuantResult, add a spec below, done.

const linearRegressionSpec: ModelSpec<"linear_regression", LinearRegressionPayload> = {
  id: "linear_regression",
  label: "Linear Regression",
  category: "Price Modeling",
  icon: TrendingUp,
  desc: "Log-linear OLS trend line. Shows where price sits relative to its long-run trajectory.",
  series: (m) => [
    { type: "line", data: m.price, color: COLORS.ORANGE, width: 1 },
    { type: "line", data: m.trend, color: COLORS.CYAN, width: 1 },
    { type: "line", data: m.forecast, color: COLORS.CYAN + "80", width: 1 },
  ],
  stats: (m) => [
    { label: "R²", value: m.r2 != null ? m.r2.toFixed(4) : "—" },
    { label: "Current price", value: fmtPrice(m.current_price) },
    { label: "Trend price", value: fmtPrice(m.current_trend) },
    {
      label: "Deviation",
      value: fmtPct(m.current_deviation_pct),
      className: m.above_trend ? "text-rose-400" : "text-emerald-400",
    },
    { label: "Daily trend growth", value: m.daily_growth_pct != null ? m.daily_growth_pct.toFixed(4) + "%" : "—" },
    { label: "30d forecast", value: fmtPrice(m.forecast.at(-1)?.value ?? 0) },
  ],
  legend: [
    { label: "Price", color: COLORS.ORANGE },
    { label: "Trend", color: COLORS.CYAN },
    { label: "30d forecast", color: COLORS.CYAN + "80" },
  ],
}

const garchSpec: ModelSpec<"garch", GarchPayload> = {
  id: "garch",
  label: "GARCH(1,1)",
  category: "Volatility Modeling",
  icon: Activity,
  desc: "Conditional heteroskedasticity model. Captures volatility clustering and forecasts risk.",
  series: (m) => [{ type: "line", data: m.volatility, color: COLORS.AMBER, width: 1 }],
  stats: (m) => {
    const regCls =
      m.vol_regime === "elevated" ? "text-rose-400" :
      m.vol_regime === "low" ? "text-emerald-400" :
      "text-amber-400"
    return [
      {
        label: "Current vol (ann.)",
        value: m.current_vol_annualized != null ? (m.current_vol_annualized * 100).toFixed(1) + "%" : "—",
        className: "text-amber-400",
      },
      { label: "Long-run vol", value: m.long_run_vol_annualized != null ? (m.long_run_vol_annualized * 100).toFixed(1) + "%" : "—" },
      { label: "30d vol forecast", value: m.forecast_30d_vol != null ? (m.forecast_30d_vol * 100).toFixed(1) + "%" : "—" },
      { label: "α (shock)", value: m.alpha != null ? m.alpha.toFixed(4) : "—" },
      { label: "β (persistence)", value: m.beta != null ? m.beta.toFixed(4) : "—" },
      { label: "α+β", value: m.persistence != null ? m.persistence.toFixed(4) : "—" },
      { label: "Regime", value: m.vol_regime, className: regCls },
    ]
  },
  legend: [{ label: "Volatility (ann.)", color: COLORS.AMBER }],
}

const monteCarloSpec: ModelSpec<"monte_carlo", MonteCarloPayload> = {
  id: "monte_carlo",
  label: "Monte Carlo",
  category: "Scenario Simulation",
  icon: GitBranch,
  desc: "500 GBM price paths over 90 days. Models uncertainty and estimates return distribution.",
  series: (m) => [
    { type: "line", data: m.percentiles.p95, color: COLORS.ROSE + "60", width: 1 },
    { type: "line", data: m.percentiles.p75, color: COLORS.ROSE + "90", width: 1 },
    { type: "line", data: m.percentiles.p50, color: COLORS.ORANGE, width: 2 },
    { type: "line", data: m.percentiles.p25, color: COLORS.EMERALD + "90", width: 1 },
    { type: "line", data: m.percentiles.p5, color: COLORS.EMERALD + "60", width: 1 },
  ],
  stats: (m) => [
    { label: "Current price", value: fmtPrice(m.current_price) },
    { label: "Simulations", value: fmtNum(m.simulations) },
    { label: "Horizon", value: `${m.days} days` },
    {
      label: "P(above current)",
      value: m.prob_above_current != null ? (m.prob_above_current * 100).toFixed(1) + "%" : "—",
      className: m.prob_above_current != null && m.prob_above_current > 0.5 ? "text-emerald-400" : "text-rose-400",
    },
    {
      label: "Expected return",
      value: fmtPct(m.expected_return_pct),
      className: m.expected_return_pct != null && m.expected_return_pct >= 0 ? "text-emerald-400" : "text-rose-400",
    },
    { label: "P5 / P50 / P95", value: `${fmtPrice(m.p5_final)} / ${fmtPrice(m.p50_final)} / ${fmtPrice(m.p95_final)}` },
  ],
  legend: [
    { label: "P5/P95", color: COLORS.ROSE + "60" },
    { label: "P25/P75", color: COLORS.ROSE },
    { label: "Median (P50)", color: COLORS.ORANGE },
    { label: "P25/P75 down", color: COLORS.EMERALD },
  ],
}

const kalmanSpec: ModelSpec<"kalman", KalmanPayload> = {
  id: "kalman",
  label: "Kalman Filter",
  category: "Signal Extraction",
  icon: Waves,
  desc: "Adaptive trend estimator. Continuously updates hidden trend state from noisy price data.",
  series: (m) => [
    { type: "line", data: m.price, color: COLORS.ORANGE, width: 1 },
    { type: "line", data: m.trend, color: COLORS.CYAN, width: 2 },
  ],
  stats: (m) => [
    { label: "Current price", value: fmtPrice(m.current_price) },
    { label: "Kalman trend", value: fmtPrice(m.current_trend_value) },
    { label: "Slope ($/day)", value: "$" + fmtNum(m.current_slope, { maximumFractionDigits: 0 }) },
    {
      label: "Trend direction",
      value: m.trend_label,
      className: m.trend_label === "bullish" ? "text-emerald-400" : "text-rose-400",
    },
    {
      label: "Price vs trend",
      value: fmtPct((m.current_price / m.current_trend_value - 1) * 100),
      className: m.current_price > m.current_trend_value ? "text-rose-400" : "text-emerald-400",
    },
  ],
  legend: [
    { label: "Price", color: COLORS.ORANGE },
    { label: "Kalman trend", color: COLORS.CYAN },
  ],
}

const hmmSpec: ModelSpec<"hmm", HmmPayload> = {
  id: "hmm",
  label: "Hidden Markov",
  category: "Regime Switching",
  icon: Network,
  desc: "3-state Gaussian HMM. Infers unobservable bull/neutral/bear market regimes.",
  series: (m) => {
    const bars = m.regimes.map((pt) => ({
      time: pt.time,
      value: 1,
      color: pt.state === 2 ? COLORS.EMERALD + "80" : pt.state === 0 ? COLORS.ROSE + "80" : COLORS.MUTED,
    }))
    return [{ type: "histogram", data: bars }]
  },
  stats: (m) => [
    { label: "Current regime", value: m.current_regime_label, className: regimeColor(m.current_regime_class) },
    { label: "Confidence", value: m.current_regime_probability != null ? (m.current_regime_probability * 100).toFixed(1) + "%" : "—" },
    { label: "States", value: `${m.n_states} (Bear / Neutral / Bull)` },
  ],
  legend: [],
  footer: "Green = Bull · Grey = Neutral · Red = Bear",
}

const arimaSpec: ModelSpec<"arima", ArimaPayload> = {
  id: "arima",
  label: "ARIMA(2,1,2)",
  category: "Time Series",
  icon: BarChart2,
  desc: "Autoregressive integrated moving-average model with 14-day price forecast and 80% CI.",
  series: (m) => [
    { type: "line", data: m.price, color: COLORS.ORANGE, width: 1 },
    { type: "line", data: m.upper, color: COLORS.CYAN + "50", width: 1 },
    { type: "line", data: m.forecast, color: COLORS.CYAN, width: 2 },
    { type: "line", data: m.lower, color: COLORS.CYAN + "50", width: 1 },
  ],
  stats: (m) => [
    { label: "Current price", value: fmtPrice(m.current_price) },
    { label: "14d forecast", value: fmtPrice(m.forecast_14d) },
    {
      label: "Forecast change",
      value: fmtPct(m.change_pct),
      className: m.change_pct >= 0 ? "text-emerald-400" : "text-rose-400",
    },
    { label: "Order", value: "ARIMA(2,1,2)" },
    { label: "CI", value: "80%" },
    { label: "Horizon", value: `${m.steps} days` },
  ],
  legend: [
    { label: "Price", color: COLORS.ORANGE },
    { label: "Forecast", color: COLORS.CYAN },
    { label: "80% CI", color: COLORS.CYAN + "80" },
  ],
}

const neuralNetworkSpec: ModelSpec<"neural_network", NeuralNetworkPayload> = {
  id: "neural_network",
  label: "Neural Network",
  category: "Deep Learning",
  icon: Brain,
  desc: "MLP(20→32→1) trained on normalized return windows. Outputs P(next-day return > 0).",
  series: (m) => [{ type: "line", data: m.signal, color: COLORS.EMERALD, width: 1 }],
  stats: (m) => {
    const pctUp = m.current_probability_up != null ? (m.current_probability_up * 100).toFixed(1) : null
    const cls =
      m.signal_label === "bullish" ? "text-emerald-400" :
      m.signal_label === "bearish" ? "text-rose-400" :
      "text-amber-400"
    return [
      { label: "P(up tomorrow)", value: pctUp != null ? pctUp + "%" : "—", className: cls },
      { label: "Signal", value: m.signal_label, className: cls },
      { label: "Test accuracy", value: (m.test_accuracy * 100).toFixed(1) + "%" },
      { label: "Training samples", value: fmtNum(m.n_train) },
      { label: "Test samples", value: fmtNum(m.n_test) },
      { label: "Architecture", value: m.architecture },
    ]
  },
  legend: [{ label: "P(up) signal — 0.5 = neutral", color: COLORS.EMERALD }],
}

const chronosSpec: ModelSpec<"timesfm", ChronosPayload> = {
  id: "timesfm", // backend still emits this key for backwards compat
  label: "Chronos",
  category: "Foundation Model",
  icon: Sigma,
  desc: "Amazon's Chronos-T5-Large foundation model. Zero-shot probabilistic 90-day forecast with 10th/90th percentile confidence bands. No training required.",
  series: (m) => [
    { type: "line", data: m.price,    color: COLORS.ORANGE,        width: 1 },
    { type: "line", data: m.upper,    color: COLORS.CYAN + "40",   width: 1 },
    { type: "line", data: m.forecast, color: COLORS.CYAN,          width: 2 },
    { type: "line", data: m.lower,    color: COLORS.CYAN + "40",   width: 1 },
  ],
  stats: (m) => {
    const dir = m.change_pct != null && m.change_pct >= 0 ? "text-emerald-400" : "text-rose-400"
    return [
      { label: "Current price", value: fmtPrice(m.current_price) },
      { label: "90d forecast", value: fmtPrice(m.forecast_90d) },
      { label: "Expected change", value: fmtPct(m.change_pct), className: dir },
      { label: "Horizon", value: `${m.horizon_days} days` },
      { label: "Context window", value: `${m.context_points} days` },
      { label: "Model", value: "chronos-t5-large" },
      { label: "Source", value: "Amazon Research" },
    ]
  },
  legend: [
    { label: "Price", color: COLORS.ORANGE },
    { label: "Forecast (90d)", color: COLORS.CYAN },
    { label: "Quantile band", color: COLORS.CYAN + "80" },
  ],
  footer: "Zero-shot · no fine-tuning",
}

// Union of every concrete spec so the registry is strongly typed at the callsite.
export type AnyModelSpec =
  | ModelSpec<"linear_regression", LinearRegressionPayload>
  | ModelSpec<"garch", GarchPayload>
  | ModelSpec<"monte_carlo", MonteCarloPayload>
  | ModelSpec<"kalman", KalmanPayload>
  | ModelSpec<"hmm", HmmPayload>
  | ModelSpec<"arima", ArimaPayload>
  | ModelSpec<"neural_network", NeuralNetworkPayload>
  | ModelSpec<"timesfm", ChronosPayload>

// Ordered registry — this is the single source of truth for model metadata,
// chart series, stat rows, and legend. To add a model: append one spec object.
// To remove: delete one spec object. No switch statements, no coupled edits.
export const MODEL_SPECS: ReadonlyArray<AnyModelSpec> = [
  linearRegressionSpec,
  garchSpec,
  monteCarloSpec,
  kalmanSpec,
  hmmSpec,
  arimaSpec,
  neuralNetworkSpec,
  chronosSpec,
]

export type ModelId = AnyModelSpec["id"]

export function getSpec(id: ModelId): AnyModelSpec {
  return MODEL_SPECS.find((s) => s.id === id)!
}
