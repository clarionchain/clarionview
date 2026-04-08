import type { Metadata } from "next"
import { WorkbenchContainer } from "@/components/workbench/workbench-container"

export const metadata: Metadata = {
  title: "DC Workbench - Bitcoin On-Chain Analytics",
  description: "Bitcoin on-chain data workbench powered by TradingView charts",
}

export default function HomePage() {
  return <WorkbenchContainer />
}
