"use client"

import { useEffect } from "react"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[ClarionView] Global error:", error)
  }, [error])

  return (
    <html lang="en" className="dark">
      <body className="bg-background text-foreground flex items-center justify-center h-screen">
        <div className="text-center space-y-3">
          <p className="text-sm font-medium text-foreground/70">Application error</p>
          <p className="text-xs text-muted-foreground/50">{error.message}</p>
          <button
            onClick={reset}
            className="px-3 py-1.5 text-xs border border-border/40 rounded-md text-muted-foreground hover:text-foreground transition-colors"
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  )
}
