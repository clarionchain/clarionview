import { DashboardPage } from "@/components/dashboards/dashboard-page"
import { SERIES_COLORS } from "@/lib/workbench-types"

const MINING_TICKERS = [
  { seriesName: "yf:MARA",  label: "Marathon Digital (MARA)",      color: SERIES_COLORS[0] },
  { seriesName: "yf:RIOT",  label: "Riot Platforms (RIOT)",        color: SERIES_COLORS[5] },
  { seriesName: "yf:CLSK",  label: "CleanSpark (CLSK)",            color: SERIES_COLORS[3] },
  { seriesName: "yf:HUT",   label: "Hut 8 Mining (HUT)",           color: SERIES_COLORS[1] },
  { seriesName: "yf:IREN",  label: "Iris Energy (IREN)",            color: SERIES_COLORS[2] },
  { seriesName: "yf:CORZ",  label: "Core Scientific (CORZ)",       color: SERIES_COLORS[10] },
  { seriesName: "yf:WULF",  label: "TeraWulf (WULF)",              color: SERIES_COLORS[4] },
  { seriesName: "yf:CIFR",  label: "Cipher Mining (CIFR)",         color: SERIES_COLORS[6] },
  { seriesName: "yf:BTBT",  label: "Bit Digital (BTBT)",           color: SERIES_COLORS[7] },
  { seriesName: "yf:BTDR",  label: "Bitdeer Technologies (BTDR)",  color: SERIES_COLORS[8] },
]

export default function MiningDashboardPage() {
  return (
    <DashboardPage
      title="Bitcoin Mining Companies"
      description="Public Bitcoin mining company performance. All series normalized to 100 at earliest date for relative comparison."
      tickers={MINING_TICKERS}
      templateId="tpl_mining"
    />
  )
}
