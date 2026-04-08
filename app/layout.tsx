import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { AppProviders } from "@/components/app-providers"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "DC Workbench - Bitcoin On-Chain Analytics",
  description: "Bitcoin on-chain data workbench powered by TradingView charts and bitview.space",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className={inter.className}>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  )
}
