"use client"

import { useEffect } from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[ClarionView] Page error:", error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
      <AlertTriangle className="h-10 w-10 text-amber-400/60" />
      <div>
        <p className="text-sm font-medium text-foreground/70">Something went wrong</p>
        <p className="text-xs text-muted-foreground/50 mt-1">
          {error.message || "An unexpected error occurred."}
        </p>
      </div>
      <button
        onClick={reset}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border/40 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
      >
        <RefreshCw className="h-3 w-3" />
        Try again
      </button>
    </div>
  )
}
