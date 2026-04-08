import { DashboardPage } from "@/components/dashboards/dashboard-page"
import { SERIES_COLORS } from "@/lib/workbench-types"

const STRATEGY_TICKERS = [
  { seriesName: "yf:MSTR",  label: "Strategy Common Stock (MSTR)",       color: SERIES_COLORS[0] },
  { seriesName: "yf:STRK",  label: "Strike Preferred (STRK)",            color: SERIES_COLORS[1] },
  { seriesName: "yf:STRD",  label: "Strife Preferred (STRD)",            color: SERIES_COLORS[2] },
  { seriesName: "yf:STRF",  label: "Strife Series A (STRF)",             color: SERIES_COLORS[3] },
  { seriesName: "yf:STRC",  label: "Convertible Notes (STRC)",           color: SERIES_COLORS[4] },
  { seriesName: "yf:SMLR",  label: "Semler Scientific (SMLR)",           color: SERIES_COLORS[5] },
  { seriesName: "yf:COIN",  label: "Coinbase (COIN)",                    color: SERIES_COLORS[6] },
  { seriesName: "yf:SQ",    label: "Block / Square (SQ)",                color: SERIES_COLORS[7] },
]

export default function StrategyDashboardPage() {
  return (
    <DashboardPage
      title="Strategy & Bitcoin Treasury"
      description="Strategy instruments (MSTR common + preferred shares) and other Bitcoin treasury companies."
      tickers={STRATEGY_TICKERS}
      templateId="tpl_strategy"
    />
  )
}
