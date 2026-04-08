/**
 * Market data categories for Yahoo Finance (yf:TICKER) and FRED (fred:SERIES_ID) series.
 * These are appended to the on-chain METRIC_CATEGORIES in the metric picker.
 *
 * Series naming convention:
 *   "yf:TICKER"     → fetched from Yahoo Finance via the Python analytics service
 *   "fred:SERIES"   → fetched from FRED API via the Python analytics service
 */

export interface MarketMetric {
  name: string       // series key used in workbench (e.g. "yf:IBIT")
  display: string    // human-readable label
  ticker?: string    // underlying exchange ticker for display
}

export interface MarketCategory {
  name: string
  source: "yfinance" | "fred"
  metrics: MarketMetric[]
}

export const MARKET_CATEGORIES: MarketCategory[] = [
  {
    name: "Bitcoin ETFs",
    source: "yfinance",
    metrics: [
      { name: "yf:IBIT",  display: "iShares Bitcoin Trust (IBIT)",      ticker: "IBIT" },
      { name: "yf:FBTC",  display: "Fidelity Bitcoin Fund (FBTC)",       ticker: "FBTC" },
      { name: "yf:ARKB",  display: "ARK 21Shares Bitcoin ETF (ARKB)",    ticker: "ARKB" },
      { name: "yf:BTCO",  display: "Invesco Galaxy Bitcoin ETF (BTCO)",  ticker: "BTCO" },
      { name: "yf:HODL",  display: "VanEck Bitcoin ETF (HODL)",          ticker: "HODL" },
      { name: "yf:EZBC",  display: "Franklin Bitcoin ETF (EZBC)",        ticker: "EZBC" },
      { name: "yf:BITB",  display: "Bitwise Bitcoin ETF (BITB)",         ticker: "BITB" },
      { name: "yf:BRRR",  display: "CoinShares Valkyrie Bitcoin (BRRR)", ticker: "BRRR" },
      { name: "yf:GBTC",  display: "Grayscale Bitcoin Trust (GBTC)",     ticker: "GBTC" },
      { name: "yf:BTC",   display: "Grayscale Bitcoin Mini (BTC)",       ticker: "BTC"  },
      { name: "yf:BTCW",  display: "WisdomTree Bitcoin Fund (BTCW)",     ticker: "BTCW" },
    ],
  },
  {
    name: "Bitcoin Treasury Companies",
    source: "yfinance",
    metrics: [
      { name: "yf:MSTR",  display: "Strategy / MicroStrategy (MSTR)",   ticker: "MSTR" },
      { name: "yf:COIN",  display: "Coinbase (COIN)",                    ticker: "COIN" },
      { name: "yf:SQ",    display: "Block / Square (SQ)",                ticker: "SQ"   },
      { name: "yf:TSLA",  display: "Tesla (TSLA)",                       ticker: "TSLA" },
      { name: "yf:SMLR",  display: "Semler Scientific (SMLR)",           ticker: "SMLR" },
      { name: "yf:KULR",  display: "KULR Technology (KULR)",             ticker: "KULR" },
    ],
  },
  {
    name: "Bitcoin Mining Companies",
    source: "yfinance",
    metrics: [
      { name: "yf:MARA",  display: "Marathon Digital (MARA)",            ticker: "MARA" },
      { name: "yf:RIOT",  display: "Riot Platforms (RIOT)",              ticker: "RIOT" },
      { name: "yf:CLSK",  display: "CleanSpark (CLSK)",                  ticker: "CLSK" },
      { name: "yf:CIFR",  display: "Cipher Mining (CIFR)",              ticker: "CIFR" },
      { name: "yf:HUT",   display: "Hut 8 Mining (HUT)",                 ticker: "HUT"  },
      { name: "yf:BTBT",  display: "Bit Digital (BTBT)",                 ticker: "BTBT" },
      { name: "yf:IREN",  display: "Iris Energy (IREN)",                 ticker: "IREN" },
      { name: "yf:CORZ",  display: "Core Scientific (CORZ)",             ticker: "CORZ" },
      { name: "yf:WULF",  display: "TeraWulf (WULF)",                    ticker: "WULF" },
      { name: "yf:BTDR",  display: "Bitdeer Technologies (BTDR)",        ticker: "BTDR" },
    ],
  },
  {
    name: "Strategy Instruments",
    source: "yfinance",
    metrics: [
      { name: "yf:MSTR",  display: "Strategy Common Stock (MSTR)",       ticker: "MSTR" },
      { name: "yf:STRK",  display: "Strategy Strike Preferred (STRK)",   ticker: "STRK" },
      { name: "yf:STRD",  display: "Strategy Strife Preferred (STRD)",   ticker: "STRD" },
      { name: "yf:STRF",  display: "Strategy Strife Series A (STRF)",    ticker: "STRF" },
      { name: "yf:STRC",  display: "Strategy Convertible Notes (STRC)",  ticker: "STRC" },
    ],
  },
  {
    name: "Federal Reserve / Macro",
    source: "fred",
    metrics: [
      { name: "fred:FEDFUNDS",   display: "Federal Funds Rate",                      ticker: "FEDFUNDS"   },
      { name: "fred:DFF",        display: "Effective Fed Funds Rate (daily)",         ticker: "DFF"        },
      { name: "fred:M2SL",       display: "M2 Money Supply",                          ticker: "M2SL"       },
      { name: "fred:WALCL",      display: "Fed Balance Sheet — Total Assets",         ticker: "WALCL"      },
      { name: "fred:RRPONTSYD",  display: "Overnight Reverse Repo (RRP)",            ticker: "RRPONTSYD"  },
      { name: "fred:CPIAUCSL",   display: "CPI — All Urban Consumers",               ticker: "CPIAUCSL"   },
      { name: "fred:PCEPI",      display: "PCE Price Index",                          ticker: "PCEPI"      },
      { name: "fred:DGS10",      display: "10-Year Treasury Yield",                  ticker: "DGS10"      },
      { name: "fred:DGS2",       display: "2-Year Treasury Yield",                   ticker: "DGS2"       },
      { name: "fred:T10Y2Y",     display: "10Y–2Y Treasury Spread",                  ticker: "T10Y2Y"     },
      { name: "fred:DTWEXBGS",   display: "Trade Weighted US Dollar Index (DXY)",    ticker: "DTWEXBGS"   },
      { name: "fred:UNRATE",     display: "Unemployment Rate",                        ticker: "UNRATE"     },
    ],
  },
]

/** All market metric series names as a flat Set for O(1) lookup. */
export const MARKET_SERIES_NAMES: Set<string> = new Set(
  MARKET_CATEGORIES.flatMap((cat) => cat.metrics.map((m) => m.name))
)

/** All market metrics as a flat array for search. */
export const MARKET_METRICS_FLAT: MarketMetric[] = MARKET_CATEGORIES.flatMap(
  (cat) => cat.metrics
)
