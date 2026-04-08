/**
 * Top-level chart categories aligned with checkonchain’s main page sections
 * (https://charts.checkonchain.com/). Subgroups under each are intentionally
 * omitted for a flatter nav — only these headings appear in the sidebar.
 */
export const CHART_NAV_GROUPS = [
  { id: "bitcoin-pricing-models", label: "Bitcoin Pricing Models" },
  { id: "spot-etf-metrics", label: "Spot ETF Metrics" },
  { id: "derivatives", label: "Derivatives" },
  { id: "strategy-b-metrics", label: "Strategy₿ Metrics" },
  { id: "profit-loss-metrics", label: "Profit/Loss Metrics" },
  { id: "lifespan-metrics", label: "Lifespan Metrics" },
  { id: "network-adoption-metrics", label: "Network Adoption Metrics" },
  { id: "supply-dynamics-metrics", label: "Supply Dynamics Metrics" },
  { id: "mining-metrics", label: "Mining Metrics" },
  { id: "technical-analysis-volatility", label: "Technical Analysis and Volatility" },
  { id: "stablecoins", label: "Stablecoins" },
  { id: "traditional-finance", label: "Traditional Finance" },
] as const

export type ChartNavGroupId = (typeof CHART_NAV_GROUPS)[number]["id"]
