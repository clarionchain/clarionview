/**
 * Pre-built workbook templates.
 * Loaded client-side — no database required. Users can load any template into
 * the workbench and save it as their own workbook.
 */

import type { SavedWorkbook, SeriesConfig } from "@/lib/workbench-types"

function cfg(
  id: string,
  seriesName: string,
  displayName: string,
  color: string,
  opts: Partial<SeriesConfig> = {}
): SeriesConfig {
  return {
    id,
    seriesName,
    displayName,
    color,
    colorOpacity: 1,
    lineStyle: "solid",
    priceScaleId: "right",
    type: "line",
    visible: true,
    ...opts,
  }
}

const T: SavedWorkbook[] = [
  // ── 1. BTC Macro Overview ─────────────────────────────────────────────────
  {
    id: "tpl_btc_macro",
    name: "BTC Macro Overview",
    savedAt: "",
    logScale: true,
    paneScales: { 0: "log", 1: "linear" },
    configs: [
      cfg("a1", "price",            "Price (USD)",        "#F7931A", { priceScaleId: "right", paneIndex: 0 }),
      cfg("a2", "realized_price",   "Realized Price",     "#2DD4BF", { priceScaleId: "right", paneIndex: 0 }),
      cfg("a3", "true_market_mean", "True Market Mean",   "#5794F2", { priceScaleId: "right", paneIndex: 0 }),
      cfg("a4", "mvrv",             "MVRV Ratio",         "#B877D9", { priceScaleId: "left",  paneIndex: 1 }),
    ],
  },

  // ── 2. Bitcoin ETF Performance ────────────────────────────────────────────
  {
    id: "tpl_etf",
    name: "Bitcoin ETF Performance",
    savedAt: "",
    logScale: false,
    paneScales: { 0: "linear" },
    configs: [
      cfg("b1", "yf:IBIT", "iShares Bitcoin (IBIT)", "#F7931A", { priceScaleId: "left" }),
      cfg("b2", "yf:FBTC", "Fidelity Bitcoin (FBTC)", "#5794F2", { priceScaleId: "left" }),
      cfg("b3", "yf:ARKB", "ARK 21Shares (ARKB)",    "#2DD4BF", { priceScaleId: "left" }),
      cfg("b4", "yf:GBTC", "Grayscale (GBTC)",        "#FADE2A", { priceScaleId: "left" }),
      cfg("b5", "yf:BTCO", "Invesco Galaxy (BTCO)",   "#B877D9", { priceScaleId: "left" }),
    ],
  },

  // ── 3. Bitcoin Mining Companies ───────────────────────────────────────────
  {
    id: "tpl_mining",
    name: "Bitcoin Mining Companies",
    savedAt: "",
    logScale: false,
    paneScales: { 0: "linear" },
    configs: [
      cfg("c1", "yf:MARA", "Marathon Digital (MARA)", "#F7931A", { priceScaleId: "left" }),
      cfg("c2", "yf:RIOT", "Riot Platforms (RIOT)",   "#FF6B6B", { priceScaleId: "left" }),
      cfg("c3", "yf:CLSK", "CleanSpark (CLSK)",        "#2DD4BF", { priceScaleId: "left" }),
      cfg("c4", "yf:HUT",  "Hut 8 Mining (HUT)",      "#5794F2", { priceScaleId: "left" }),
      cfg("c5", "yf:IREN", "Iris Energy (IREN)",       "#B877D9", { priceScaleId: "left" }),
      cfg("c6", "yf:CORZ", "Core Scientific (CORZ)",  "#34D399", { priceScaleId: "left" }),
    ],
  },

  // ── 4. Strategy Stack ─────────────────────────────────────────────────────
  {
    id: "tpl_strategy",
    name: "Strategy Stack",
    savedAt: "",
    logScale: false,
    paneScales: { 0: "linear", 1: "linear" },
    configs: [
      cfg("d1", "yf:MSTR", "Strategy Common (MSTR)", "#F7931A", { priceScaleId: "right", paneIndex: 0 }),
      cfg("d2", "yf:STRK", "Strike Preferred (STRK)", "#5794F2", { priceScaleId: "left",  paneIndex: 1 }),
      cfg("d3", "yf:STRF", "Strife Preferred (STRF)", "#2DD4BF", { priceScaleId: "left",  paneIndex: 1 }),
    ],
  },

  // ── 5. Macro Liquidity Overlay ────────────────────────────────────────────
  {
    id: "tpl_macro",
    name: "Macro Liquidity Overlay",
    savedAt: "",
    logScale: true,
    paneScales: { 0: "log", 1: "linear", 2: "linear" },
    configs: [
      cfg("e1", "price",        "BTC Price",          "#F7931A", { priceScaleId: "right", paneIndex: 0 }),
      cfg("e2", "fred:M2SL",    "M2 Money Supply",    "#5794F2", { priceScaleId: "left",  paneIndex: 1 }),
      cfg("e3", "fred:WALCL",   "Fed Balance Sheet",  "#B877D9", { priceScaleId: "left",  paneIndex: 1 }),
      cfg("e4", "fred:FEDFUNDS","Fed Funds Rate",      "#FF6B6B", { priceScaleId: "left",  paneIndex: 2 }),
    ],
  },

  // ── 6. Valuation Dashboard ────────────────────────────────────────────────
  {
    id: "tpl_valuation",
    name: "Valuation Dashboard",
    savedAt: "",
    logScale: true,
    paneScales: { 0: "log", 1: "linear", 2: "linear", 3: "linear" },
    configs: [
      cfg("f1", "price",      "BTC Price", "#F7931A", { priceScaleId: "right", paneIndex: 0 }),
      cfg("f2", "mvrv",       "MVRV Ratio",           "#B877D9", { priceScaleId: "left", paneIndex: 1 }),
      cfg("f3", "nupl",       "NUPL",                 "#2DD4BF", { priceScaleId: "left", paneIndex: 2 }),
      cfg("f4", "sopr_24h",   "SOPR",                 "#FADE2A", { priceScaleId: "left", paneIndex: 3 }),
    ],
  },

  // ── 7. Market Cycle Signals ───────────────────────────────────────────────
  {
    id: "tpl_cycle",
    name: "Market Cycle Signals",
    savedAt: "",
    logScale: true,
    paneScales: { 0: "log", 1: "linear", 2: "linear" },
    configs: [
      cfg("g1", "price",          "BTC Price",        "#F7931A", { priceScaleId: "right", paneIndex: 0 }),
      cfg("g2", "realized_price", "Realized Price",   "#2DD4BF", { priceScaleId: "right", paneIndex: 0 }),
      cfg("g3", "rhodl_ratio",    "RHODL Ratio",      "#B877D9", { priceScaleId: "left",  paneIndex: 1 }),
      cfg("g4", "reserve_risk",   "Reserve Risk",     "#FF6B6B", { priceScaleId: "left",  paneIndex: 2 }),
    ],
  },

  // ── 8. Mining Health ──────────────────────────────────────────────────────
  {
    id: "tpl_mining_health",
    name: "Mining Health",
    savedAt: "",
    logScale: true,
    paneScales: { 0: "log", 1: "log", 2: "linear", 3: "linear" },
    configs: [
      cfg("h1", "price",         "BTC Price",        "#F7931A", { priceScaleId: "right", paneIndex: 0 }),
      cfg("h2", "hash_rate",     "Hash Rate",        "#5794F2", { priceScaleId: "left",  paneIndex: 1 }),
      cfg("h3", "difficulty",    "Difficulty",       "#B877D9", { priceScaleId: "left",  paneIndex: 2 }),
      cfg("h4", "puell_multiple","Puell Multiple",   "#FADE2A", { priceScaleId: "left",  paneIndex: 3 }),
    ],
  },

  // ── 9. DXY vs BTC ─────────────────────────────────────────────────────────
  {
    id: "tpl_dxy",
    name: "DXY vs BTC",
    savedAt: "",
    logScale: true,
    paneScales: { 0: "log", 1: "linear" },
    configs: [
      cfg("i1", "price",           "BTC Price",      "#F7931A", { priceScaleId: "right", paneIndex: 0 }),
      cfg("i2", "fred:DTWEXBGS",   "DXY Index",      "#5794F2", { priceScaleId: "left",  paneIndex: 1 }),
      cfg("i3", "fred:DGS10",      "10Y Yield",      "#FF6B6B", { priceScaleId: "left",  paneIndex: 1 }),
    ],
  },

  // ── 10. Supply Dynamics ───────────────────────────────────────────────────
  {
    id: "tpl_supply",
    name: "Supply Dynamics",
    savedAt: "",
    logScale: true,
    paneScales: { 0: "log", 1: "linear", 2: "linear" },
    configs: [
      cfg("j1", "price",            "BTC Price",       "#F7931A", { priceScaleId: "right", paneIndex: 0 }),
      cfg("j2", "lth_supply",       "LTH Supply",      "#5794F2", { priceScaleId: "left",  paneIndex: 1 }),
      cfg("j3", "sth_supply",       "STH Supply",      "#FF6B6B", { priceScaleId: "left",  paneIndex: 1 }),
      cfg("j4", "supply_in_profit", "Supply in Profit",  "#2DD4BF", { priceScaleId: "left", paneIndex: 2 }),
    ],
  },
]

export const WORKBOOK_TEMPLATES: SavedWorkbook[] = T
