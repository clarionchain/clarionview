"use client"

// ─────────────────────────────────────────────────────────────────────────────
// Insights landing page
//
// Core value-prop surface: a small, fixed grid of insight cards that answer
// stable questions about the BTC market. The user's eye learns where each
// answer lives (cycle upper-left, regime next to it, etc.) so cognition stays
// bounded even as the daily answers change.
//
// Each card links into the Workbench view that drives the synthesis, so the
// analyst path is preserved — stop at the headline, or click through to the
// tool.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
  Sparkles, Loader2, RefreshCw, AlertCircle, ArrowRight,
  CircleDot, TrendingUp, TrendingDown, Minus, AlertTriangle,
} from "lucide-react"
import { withBase } from "@/lib/base-path"
import { cn } from "@/lib/utils"
import { buildInsights, type Insight, type Lean } from "@/lib/insights-engine"
import type { QuantResult } from "@/lib/quant-models"

// ── Visual mapping for Lean ──────────────────────────────────────────────────

function leanStyle(lean: Lean) {
  switch (lean) {
    case "bullish":
      return { color: "text-emerald-400", ring: "ring-emerald-500/20", Icon: TrendingUp, label: "bullish" }
    case "bearish":
      return { color: "text-rose-400", ring: "ring-rose-500/20", Icon: TrendingDown, label: "bearish" }
    case "caution":
      return { color: "text-amber-400", ring: "ring-amber-500/20", Icon: AlertTriangle, label: "caution" }
    default:
      return { color: "text-muted-foreground", ring: "ring-border/30", Icon: Minus, label: "neutral" }
  }
}

// ── Confidence dot strip ─────────────────────────────────────────────────────

function ConfidenceStrip({ value }: { value: number }) {
  // 10 dots; fill proportional to confidence/10
  const filled = Math.round(value / 10)
  return (
    <div className="flex items-center gap-0.5" aria-label={`Confidence ${value}%`}>
      {Array.from({ length: 10 }).map((_, i) => (
        <span
          key={i}
          className={cn(
            "inline-block h-1 w-1 rounded-full",
            i < filled ? "bg-foreground/70" : "bg-foreground/10"
          )}
        />
      ))}
      <span className="ml-1.5 text-[10px] text-muted-foreground/40 tabular-nums">{value}</span>
    </div>
  )
}

// ── Insight card ─────────────────────────────────────────────────────────────

function InsightCard({ insight }: { insight: Insight }) {
  const router = useRouter()
  const style = leanStyle(insight.lean)
  const Icon = style.Icon
  return (
    <button
      onClick={() => router.push(withBase(insight.deepLink))}
      className={cn(
        "group relative flex flex-col gap-3 rounded-lg border border-border/40 bg-card/40 p-5 text-left",
        "transition-all hover:bg-card/70 hover:border-border/70 hover:ring-1",
        style.ring
      )}
    >
      {/* Row 1: question label + lean pill */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
          {insight.question}
        </span>
        <span className={cn("flex items-center gap-1 text-[10px] font-medium", style.color)}>
          <Icon className="h-3 w-3" />
          {style.label}
        </span>
      </div>

      {/* Row 2: headline (the actual insight) */}
      <p className={cn("text-[15px] font-medium leading-snug", style.color)}>
        {insight.headline}
      </p>

      {/* Row 3: contributors */}
      <ul className="space-y-0.5 text-xs text-muted-foreground/60">
        {insight.contributors.map((c, i) => (
          <li key={i} className="flex items-start gap-1.5">
            <CircleDot className="mt-1 h-2 w-2 shrink-0 opacity-30" />
            <span>{c}</span>
          </li>
        ))}
      </ul>

      {/* Row 4: confidence + open */}
      <div className="mt-auto flex items-center justify-between pt-2">
        <ConfidenceStrip value={insight.confidence} />
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground/40 transition-colors group-hover:text-muted-foreground">
          Open in Workbench
          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </button>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function InsightsPage() {
  const [data, setData] = useState<QuantResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (method: "GET" | "POST" = "GET") => {
    method === "GET" ? setLoading(true) : setRefreshing(true)
    setError(null)
    try {
      const r = await fetch(withBase("/api/quant"), { method, credentials: "include" })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setData(await r.json())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const insights = data ? buildInsights(data) : []

  return (
    <div className="flex flex-col h-full gap-0 -m-4 lg:-m-6">
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/30 bg-card/80 px-4 backdrop-blur-md">
        <Sparkles className="h-4 w-4 text-muted-foreground/50" />
        <span className="text-sm font-medium">Today&apos;s Insights</span>
        {data && (
          <span className="text-xs text-muted-foreground/30">— {data.price_date}</span>
        )}
        <div className="flex-1" />
        <button
          onClick={() => load("POST")}
          disabled={refreshing || loading}
          className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent/30 rounded transition-colors"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          Recompute
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground/40">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">Reading the market…</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-rose-400/70">
            <AlertCircle className="h-8 w-8" />
            <p className="text-sm">{error}</p>
            <button onClick={() => load()} className="text-xs underline text-muted-foreground/50 hover:text-muted-foreground">
              Retry
            </button>
          </div>
        ) : data ? (
          <div className="mx-auto max-w-6xl p-4 lg:p-8">
            {/* Spot line — a single anchor number so the user has orientation */}
            <div className="mb-6 flex items-baseline gap-3">
              <span className="text-3xl font-semibold text-orange-400">
                ${data.price_current.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
              <span className="text-xs text-muted-foreground/50">BTC · {data.price_date}</span>
            </div>

            {/* Insight grid — fixed slots, always in the same order */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {insights.map((i) => (
                <InsightCard key={i.slot} insight={i} />
              ))}
            </div>

            {/* Footer: provenance */}
            <div className="mt-8 border-t border-border/20 pt-4 text-[10px] text-muted-foreground/30">
              Synthesized from {data.data_points.toLocaleString()} daily closes ·
              Last computed {new Date(data.generated_at).toLocaleTimeString()} ·
              Click any card to open the underlying tool
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
