import { DashboardPage } from "@/components/dashboards/dashboard-page"
import { SERIES_COLORS } from "@/lib/workbench-types"

const MACRO_TICKERS = [
  { seriesName: "fred:FEDFUNDS",  label: "Federal Funds Rate",            color: SERIES_COLORS[5] },
  { seriesName: "fred:M2SL",      label: "M2 Money Supply",               color: SERIES_COLORS[1] },
  { seriesName: "fred:WALCL",     label: "Fed Balance Sheet",             color: SERIES_COLORS[2] },
  { seriesName: "fred:RRPONTSYD", label: "Overnight Reverse Repo (RRP)",  color: SERIES_COLORS[4] },
  { seriesName: "fred:DGS10",     label: "10-Year Treasury Yield",        color: SERIES_COLORS[3] },
  { seriesName: "fred:DGS2",      label: "2-Year Treasury Yield",         color: SERIES_COLORS[6] },
  { seriesName: "fred:T10Y2Y",    label: "10Y–2Y Treasury Spread",        color: SERIES_COLORS[7] },
  { seriesName: "fred:DTWEXBGS",  label: "Trade Weighted USD (DXY)",      color: SERIES_COLORS[8] },
  { seriesName: "fred:CPIAUCSL",  label: "CPI — All Urban Consumers",     color: SERIES_COLORS[9] },
  { seriesName: "fred:UNRATE",    label: "Unemployment Rate",              color: SERIES_COLORS[11] },
]

export default function MacroDashboardPage() {
  return (
    <DashboardPage
      title="Federal Reserve / Macro Dashboard"
      description="Key Federal Reserve and macroeconomic indicators from FRED. Requires FRED_API_KEY to be configured."
      tickers={MACRO_TICKERS}
      templateId="tpl_macro"
    />
  )
}
