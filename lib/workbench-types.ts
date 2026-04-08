export interface SeriesDataPoint {
  time: string
  value: number
}

export interface SeriesConfig {
  id: string
  seriesName: string
  displayName: string
  color: string
  /** 0–1; applied to stroke/fill. Default 1. */
  colorOpacity?: number
  /** Line and area only; ignored for histogram. */
  lineStyle?: "solid" | "dotted"
  priceScaleId: "left" | "right"
  type: "line" | "area" | "histogram"
  visible: boolean
  paneIndex?: number
  isFormula?: boolean
  formula?: string
  variables?: Record<string, string>
}

/** Maximum number of vertical panes (0-based indices 0..MAX_LAYOUT_PANES-1). */
export const MAX_LAYOUT_PANES = 8

/** Coerce pane index to a non-negative integer (localStorage JSON can revive numbers as strings). */
export function normalizePaneIndex(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.floor(n)
}

export function normalizeSeriesConfig(c: SeriesConfig): SeriesConfig {
  const colorOpacity =
    typeof c.colorOpacity === "number" && Number.isFinite(c.colorOpacity)
      ? Math.min(1, Math.max(0, c.colorOpacity))
      : 1
  const lineStyle: "solid" | "dotted" = c.lineStyle === "dotted" ? "dotted" : "solid"
  const withStyle = { ...c, colorOpacity, lineStyle }
  if (c.paneIndex === undefined) return withStyle
  const paneIndex = normalizePaneIndex(c.paneIndex)
  return paneIndex === c.paneIndex ? withStyle : { ...withStyle, paneIndex }
}

/** Clamp corrupt saved state when pane indices exceed MAX_LAYOUT_PANES (legacy bugs / hand-edited storage). */
export function normalizeSeriesConfigs(configs: SeriesConfig[]): SeriesConfig[] {
  const coerced = configs.map(normalizeSeriesConfig)
  if (coerced.length === 0) return coerced
  const indices = coerced.map((c) => normalizePaneIndex(c.paneIndex ?? 0))
  const maxIdx = Math.max(0, ...indices)
  if (maxIdx < MAX_LAYOUT_PANES) return coerced
  const cap = MAX_LAYOUT_PANES - 1
  return coerced.map((c) => {
    const pi = normalizePaneIndex(c.paneIndex ?? 0)
    const clamped = Math.min(pi, cap)
    return clamped === pi ? c : { ...c, paneIndex: clamped }
  })
}

export function maxPaneIndexUsed(configs: { paneIndex?: number }[]): number {
  if (configs.length === 0) return 0
  return Math.max(0, ...configs.map((c) => normalizePaneIndex(c.paneIndex ?? 0)))
}

/** How many pane slots exist (1 + highest index in use). */
export function layoutPaneSlotCount(configs: { paneIndex?: number }[]): number {
  return Math.max(1, maxPaneIndexUsed(configs) + 1)
}

export interface ActiveSeries extends SeriesConfig {
  data: SeriesDataPoint[]
}

export interface CrosshairValues {
  time: string
  entries: Record<string, number | null>
}

export interface SavedWorkbook {
  id: string
  name: string
  configs: SeriesConfig[]
  logScale: boolean
  paneScales?: Record<number, "log" | "linear">
  savedAt: string
}

const UPPER_WORDS = new Set([
  "mvrv", "nupl", "sopr", "lth", "sth", "usd", "btc", "sma", "ema", "ath",
  "rsi", "dca", "nvt", "ohlc", "utxo", "hodl", "rhodl", "phs", "ths",
  "bps", "p2pkh", "p2sh", "p2tr", "p2wpkh", "p2wsh", "pnl", "nvt", "pi",
  "asopr", "aviv",
])

export function formatSeriesName(name: string): string {
  return name
    .split("_")
    .map((word) =>
      UPPER_WORDS.has(word.toLowerCase())
        ? word.toUpperCase()
        : /^\d+[a-z]+$/.test(word)
          ? word.toUpperCase()
          : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join(" ")
}

export function formatValue(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(2)}T`
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (abs >= 10_000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 })
  if (abs >= 100) return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (abs >= 1) return value.toFixed(4)
  if (abs >= 0.001) return value.toFixed(6)
  if (abs === 0) return "0"
  return value.toExponential(3)
}

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z")
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}

export const SERIES_COLORS = [
  "#F7931A", // Bitcoin orange
  "#5794F2", // Blue
  "#B877D9", // Purple
  "#2DD4BF", // Teal
  "#FADE2A", // Yellow
  "#FF6B6B", // Coral red
  "#00D4FF", // Cyan
  "#E879F9", // Magenta
  "#8AB8FF", // Light blue
  "#A78BFA", // Violet
  "#34D399", // Emerald
  "#FB923C", // Light orange
]

export function pickColor(used: string[]): string {
  const available = SERIES_COLORS.filter((c) => !used.includes(c))
  return available[0] ?? SERIES_COLORS[used.length % SERIES_COLORS.length]
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

export const METRIC_CATEGORIES = [
  {
    name: "Price",
    metrics: [
      { name: "price", display: "Price (USD)" },
      { name: "price_sma_200d", display: "SMA 200D" },
      { name: "price_sma_200w", display: "SMA 200W" },
      { name: "price_ema_200d", display: "EMA 200D" },
      { name: "price_sma_111d", display: "SMA 111D" },
      { name: "price_sma_350d", display: "SMA 350D×2" },
      { name: "price_drawdown", display: "Drawdown" },
      { name: "price_ath", display: "All-Time High" },
    ],
  },
  {
    name: "Capitalization",
    metrics: [
      { name: "market_cap", display: "Market Cap" },
      { name: "realized_cap", display: "Realized Cap" },
      { name: "thermo_cap", display: "Thermocap" },
      { name: "investor_cap", display: "Investor Cap" },
      { name: "active_cap", display: "Active Cap" },
      { name: "cointime_cap", display: "Cointime Cap" },
      { name: "vaulted_cap", display: "Vaulted Cap" },
    ],
  },
  {
    name: "Valuation",
    metrics: [
      { name: "mvrv", display: "MVRV Ratio" },
      { name: "nupl", display: "NUPL" },
      { name: "sopr_24h", display: "SOPR" },
      { name: "puell_multiple", display: "Puell Multiple" },
      { name: "rhodl_ratio", display: "RHODL Ratio" },
      { name: "reserve_risk", display: "Reserve Risk" },
      { name: "nvt", display: "NVT Ratio" },
      { name: "stock_to_flow", display: "Stock-to-Flow" },
      { name: "pi_cycle", display: "Pi Cycle Top" },
      { name: "aviv_ratio", display: "AVIV Ratio" },
    ],
  },
  {
    name: "Pricing Models",
    metrics: [
      { name: "realized_price", display: "Realized Price" },
      { name: "true_market_mean", display: "True Market Mean" },
      { name: "active_price", display: "Active Price" },
      { name: "cointime_price", display: "Cointime Price" },
      { name: "investor_price", display: "Investor Price" },
      { name: "vaulted_price", display: "Vaulted Price" },
    ],
  },
  {
    name: "Supply",
    metrics: [
      { name: "supply", display: "Total Supply" },
      { name: "lth_supply", display: "LTH Supply" },
      { name: "sth_supply", display: "STH Supply" },
      { name: "supply_in_profit", display: "Supply in Profit" },
      { name: "supply_in_loss", display: "Supply in Loss" },
      { name: "active_supply", display: "Active Supply" },
      { name: "vaulted_supply", display: "Vaulted Supply" },
    ],
  },
  {
    name: "Holder Cohorts",
    metrics: [
      { name: "lth_mvrv", display: "LTH MVRV" },
      { name: "sth_mvrv", display: "STH MVRV" },
      { name: "lth_nupl", display: "LTH NUPL" },
      { name: "sth_nupl", display: "STH NUPL" },
      { name: "lth_sopr_24h", display: "LTH SOPR" },
      { name: "sth_sopr_24h", display: "STH SOPR" },
    ],
  },
  {
    name: "Mining",
    metrics: [
      { name: "hash_rate", display: "Hash Rate" },
      { name: "difficulty", display: "Difficulty" },
      { name: "subsidy", display: "Block Subsidy" },
      { name: "hash_price_ths", display: "Hash Price (TH/s)" },
      { name: "fee", display: "Avg Transaction Fee" },
    ],
  },
  {
    name: "Network Activity",
    metrics: [
      { name: "tx_count", display: "Transaction Count" },
      { name: "transfer_volume", display: "Transfer Volume" },
      { name: "addr_count", display: "Address Count" },
      { name: "utxo_count", display: "UTXO Count" },
      { name: "new_addr_count", display: "New Addresses" },
    ],
  },
  {
    name: "Profitability",
    metrics: [
      { name: "realized_profit", display: "Realized Profit" },
      { name: "realized_loss", display: "Realized Loss" },
      { name: "net_realized_pnl", display: "Net Realized P&L" },
    ],
  },
  {
    name: "Sentiment",
    metrics: [
      { name: "greed_index", display: "Greed Index" },
      { name: "pain_index", display: "Pain Index" },
      { name: "liveliness", display: "Liveliness" },
      { name: "dormancy_flow", display: "Dormancy Flow" },
    ],
  },
]
