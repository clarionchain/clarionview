import { DashboardPage } from "@/components/dashboards/dashboard-page"
import { SERIES_COLORS } from "@/lib/workbench-types"

const ETF_TICKERS = [
  { seriesName: "yf:IBIT",  label: "iShares Bitcoin (IBIT)",      color: SERIES_COLORS[0] },
  { seriesName: "yf:FBTC",  label: "Fidelity Bitcoin (FBTC)",      color: SERIES_COLORS[1] },
  { seriesName: "yf:ARKB",  label: "ARK 21Shares (ARKB)",          color: SERIES_COLORS[2] },
  { seriesName: "yf:GBTC",  label: "Grayscale (GBTC)",              color: SERIES_COLORS[3] },
  { seriesName: "yf:BTCO",  label: "Invesco Galaxy (BTCO)",         color: SERIES_COLORS[4] },
  { seriesName: "yf:HODL",  label: "VanEck (HODL)",                 color: SERIES_COLORS[5] },
  { seriesName: "yf:BITB",  label: "Bitwise (BITB)",                color: SERIES_COLORS[6] },
  { seriesName: "yf:BRRR",  label: "CoinShares Valkyrie (BRRR)",   color: SERIES_COLORS[7] },
]

export default function EtfDashboardPage() {
  return (
    <DashboardPage
      title="Bitcoin ETF Dashboard"
      description="Spot Bitcoin ETF performance comparison. All series normalized to 100 at inception for relative comparison."
      tickers={ETF_TICKERS}
      templateId="tpl_etf"
    />
  )
}
