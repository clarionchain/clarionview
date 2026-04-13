import type { Metadata, Viewport } from "next"
import { AppProviders } from "@/components/app-providers"
import "../globals.css"

export const metadata: Metadata = {
  title: "ClarionView — Insights",
  description: "Bitcoin on-chain insights, optimized for mobile.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ClarionView",
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#09090b",
}

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-background text-foreground overflow-hidden">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  )
}
