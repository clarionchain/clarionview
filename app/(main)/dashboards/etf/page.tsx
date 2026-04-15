import { DashboardPage } from "@/components/dashboards/dashboard-page"
import { SERIES_COLORS } from "@/lib/workbench-types"

const ETF_TICKERS = [
  // BTC price on left axis — reference line, not normalized
  { seriesName: "yf:BTC-USD", label: "BTC Price",                   color: "#f7931a40", axis: "left" as const },
  // ETFs on right axis — normalized to 100 at inception
  { seriesName: "yf:IBIT",    label: "iShares Bitcoin (IBIT)",      color: SERIES_COLORS[0] },
  { seriesName: "yf:FBTC",    label: "Fidelity Bitcoin (FBTC)",     color: SERIES_COLORS[1] },
  { seriesName: "yf:ARKB",    label: "ARK 21Shares (ARKB)",         color: SERIES_COLORS[2] },
  { seriesName: "yf:GBTC",    label: "Grayscale (GBTC)",            color: SERIES_COLORS[3] },
  { seriesName: "yf:BTCO",    label: "Invesco Galaxy (BTCO)",       color: SERIES_COLORS[4] },
  { seriesName: "yf:HODL",    label: "VanEck (HODL)",               color: SERIES_COLORS[5] },
  { seriesName: "yf:BITB",    label: "Bitwise (BITB)",              color: SERIES_COLORS[6] },
  { seriesName: "yf:BRRR",    label: "CoinShares Valkyrie (BRRR)", color: SERIES_COLORS[7] },
]

export default function EtfDashboardPage() {
  return (
    <DashboardPage
      title="Bitcoin ETF Dashboard"
      description="How much has each spot Bitcoin ETF returned since the Jan 11, 2024 launch date? Right axis shows % return; BTC price shown for context."
      tickers={ETF_TICKERS}
      templateId="tpl_etf"
      excludeAxisFromStats="left"
      clipFromDate="2024-01-11"
    />
  )
}
