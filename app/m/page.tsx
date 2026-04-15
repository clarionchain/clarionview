"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import {
  TrendingUp, TrendingDown, Activity, Lightbulb, RefreshCw,
  Loader2, AlertTriangle, ChevronLeft, ChevronRight, Zap, Bitcoin,
} from "lucide-react"
import { withBase } from "@/lib/base-path"
import { cn } from "@/lib/utils"

interface Signal {
  type: string
  level: "info" | "warning" | "critical"
  title: string
  body: string
  metric: string
  value: number
}

interface Insight {
  date: string
  signals: Signal[]
  snapshot: Record<string, number>
  changes: Record<string, number>
  narrative: string
  status: string
}

interface MobileMetric {
  label: string
  category: string
  description: string
  value: number
  value_fmt: string
  zscore_8y: number | null
  percentile_8y: number | null
  quantile_bucket: number | null
  signal: string
}

// ── colours ────────────────────────────────────────────────────────────────────

const LEVEL_COLORS = {
  critical: { bg: "bg-rose-500/10",    border: "border-rose-500/30",    text: "text-rose-400",    dot: "bg-rose-500"    },
  warning:  { bg: "bg-amber-500/10",   border: "border-amber-500/30",   text: "text-amber-400",   dot: "bg-amber-500"   },
  info:     { bg: "bg-cyan-500/10",    border: "border-cyan-500/30",    text: "text-cyan-400",    dot: "bg-cyan-500"    },
}

const SIGNAL_STYLES: Record<string, { bg: string; border: string; text: string; label: string }> = {
  overbought: { bg: "bg-rose-500/10",    border: "border-rose-500/30",    text: "text-rose-400",    label: "Overbought"  },
  elevated:   { bg: "bg-amber-500/10",   border: "border-amber-500/30",   text: "text-amber-400",   label: "Elevated"    },
  neutral:    { bg: "bg-border/5",       border: "border-border/20",      text: "text-muted-foreground", label: "Neutral" },
  depressed:  { bg: "bg-cyan-500/10",    border: "border-cyan-500/30",    text: "text-cyan-400",    label: "Depressed"   },
  oversold:   { bg: "bg-emerald-500/10", border: "border-emerald-500/30", text: "text-emerald-400", label: "Oversold"    },
}

// 20-segment bar color — green (cheap) → amber (fair) → red (expensive)
function segmentColor(idx: number): string {
  if (idx <= 1)  return "bg-emerald-600"
  if (idx <= 3)  return "bg-emerald-500"
  if (idx <= 5)  return "bg-cyan-500"
  if (idx <= 8)  return "bg-cyan-400"
  if (idx <= 11) return "bg-amber-400"
  if (idx <= 14) return "bg-orange-500"
  if (idx <= 16) return "bg-rose-500"
  return "bg-rose-600"
}

// ── helpers ────────────────────────────────────────────────────────────────────

function formatPrice(n: number) {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

// ── MetricCard ────────────────────────────────────────────────────────────────

function MetricCard({
  metric,
  index,
  total,
}: {
  metric: MobileMetric
  index: number
  total: number
}) {
  const sig = SIGNAL_STYLES[metric.signal] ?? SIGNAL_STYLES.neutral
  const bucket = metric.quantile_bucket  // 0–19

  // maps z ∈ [−3, +3] → percentage on a track
  const zPos =
    metric.zscore_8y !== null
      ? Math.min(100, Math.max(0, ((metric.zscore_8y + 3) / 6) * 100))
      : 50

  const zColor =
    zPos >= 83 ? "bg-rose-500"
    : zPos >= 67 ? "bg-orange-500"
    : zPos >= 50 ? "bg-amber-400"
    : zPos >= 33 ? "bg-cyan-400"
    : zPos >= 17 ? "bg-cyan-500"
    : "bg-emerald-500"

  return (
    <div className={cn("flex flex-col h-full rounded-2xl border p-5", sig.bg, sig.border)}>

      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50 bg-muted/20 rounded px-1.5 py-0.5">
          {metric.category}
        </span>
        <div className="flex items-center gap-2">
          <span className={cn("text-[10px] font-medium uppercase tracking-wider", sig.text)}>
            {sig.label}
          </span>
          <span className="text-[10px] text-muted-foreground/25">{index + 1}/{total}</span>
        </div>
      </div>

      {/* Name + value */}
      <h2 className="text-base font-semibold text-foreground leading-tight mb-0.5">{metric.label}</h2>
      <div className="text-3xl font-bold tabular-nums text-foreground mb-2">{metric.value_fmt}</div>

      {/* Description */}
      <p className="text-xs text-muted-foreground/50 leading-relaxed flex-1 mb-4">{metric.description}</p>

      {/* 8-year Z-score track */}
      {metric.zscore_8y !== null && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-muted-foreground/40 uppercase tracking-wider">8-yr Z-Score</span>
            <span className={cn("text-sm font-mono font-semibold", sig.text)}>
              {metric.zscore_8y >= 0 ? "+" : ""}{metric.zscore_8y.toFixed(2)}σ
            </span>
          </div>
          {/* track */}
          <div className="relative h-1 rounded-full bg-border/20 mx-1">
            {/* center tick */}
            <div className="absolute inset-y-0 left-1/2 -translate-x-px w-0.5 bg-border/40 rounded-full" />
            {/* dot indicator */}
            <div
              className={cn("absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-background shadow-sm", zColor)}
              style={{ left: `calc(${zPos}% - 6px)` }}
            />
          </div>
          <div className="flex justify-between mt-1 px-1">
            <span className="text-[9px] text-muted-foreground/20">−3σ</span>
            <span className="text-[9px] text-muted-foreground/20">0</span>
            <span className="text-[9px] text-muted-foreground/20">+3σ</span>
          </div>
        </div>
      )}

      {/* 8-year percentile quantile bar */}
      {bucket !== null && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-muted-foreground/40 uppercase tracking-wider">8-yr Percentile</span>
            <span className="text-xs text-muted-foreground/50 tabular-nums">
              {bucket * 5}–{Math.min(100, (bucket + 1) * 5)}th pct
            </span>
          </div>
          <div className="flex gap-px">
            {Array.from({ length: 20 }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  "flex-1 rounded-[2px] transition-all",
                  i === bucket
                    ? cn("h-3", segmentColor(i))
                    : i < bucket
                      ? cn("h-2 opacity-30", segmentColor(i))
                      : "h-2 bg-muted/15"
                )}
              />
            ))}
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[9px] text-muted-foreground/20">0%</span>
            <span className="text-[9px] text-muted-foreground/20">100%</span>
          </div>
        </div>
      )}

      {/* Swipe hint */}
      <div className="mt-4 flex items-center justify-center gap-1 opacity-20">
        <ChevronLeft className="h-4 w-4" />
        <span className="text-xs">swipe</span>
        <ChevronRight className="h-4 w-4" />
      </div>
    </div>
  )
}

// ── SignalCard ────────────────────────────────────────────────────────────────

function SignalCard({ signal, index, total }: { signal: Signal; index: number; total: number }) {
  const c = LEVEL_COLORS[signal.level]
  const isUp   = signal.type.includes("overbought") || signal.type.includes("high") || signal.type.includes("euphoria")
  const isDown = signal.type.includes("oversold")   || signal.type.includes("capitulation") || signal.type.includes("loss")

  return (
    <div className={cn("flex flex-col h-full rounded-2xl border p-6", c.bg, c.border)}>
      <div className="flex items-center justify-between mb-4">
        <span className={cn("text-xs font-medium uppercase tracking-wider", c.text)}>{signal.level}</span>
        <span className="text-xs text-muted-foreground/40">{index + 1} / {total}</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <div className={cn("rounded-xl p-3", c.bg, "border", c.border)}>
          {isUp ? <TrendingUp className={cn("h-6 w-6", c.text)} /> : isDown ? <TrendingDown className={cn("h-6 w-6", c.text)} /> : <Activity className={cn("h-6 w-6", c.text)} />}
        </div>
        <div>
          <div className={cn("text-2xl font-bold tabular-nums", c.text)}>
            {signal.metric === "price"
              ? formatPrice(signal.value)
              : signal.metric.includes("mri")
                ? signal.value.toFixed(1)
                : signal.value.toFixed(signal.value < 10 ? 3 : 1)}
          </div>
          <div className="text-xs text-muted-foreground/50 font-mono uppercase">{signal.metric.replace(/_/g, " ")}</div>
        </div>
      </div>
      <h2 className="text-lg font-semibold text-foreground leading-tight mb-3">{signal.title}</h2>
      <p className="text-sm text-muted-foreground/70 leading-relaxed flex-1">{signal.body}</p>
      <div className="mt-6 flex items-center justify-center gap-1 opacity-30">
        <ChevronLeft className="h-4 w-4" />
        <span className="text-xs">swipe</span>
        <ChevronRight className="h-4 w-4" />
      </div>
    </div>
  )
}

// ── SummaryCard ───────────────────────────────────────────────────────────────

function SummaryCard({ insight, total }: { insight: Insight; total: number }) {
  const price    = insight.snapshot.price
  const mri      = insight.snapshot.mri_index
  const ch1d     = insight.changes["1d"]
  const ch7d     = insight.changes["7d"]
  const critCount = insight.signals.filter((s) => s.level === "critical").length
  const warnCount = insight.signals.filter((s) => s.level === "warning").length

  return (
    <div className="flex flex-col h-full rounded-2xl border border-border/30 bg-card/60 p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <Bitcoin className="h-5 w-5 text-orange-400" />
          <span className="text-sm font-semibold">ClarionView</span>
        </div>
        <div className="flex items-center gap-1.5">
          {critCount > 0 && <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-rose-500/15 text-rose-400">{critCount} critical</span>}
          {warnCount > 0 && <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-amber-500/15 text-amber-400">{warnCount} warning</span>}
        </div>
      </div>

      {price && (
        <div className="mb-5">
          <div className="text-xs text-muted-foreground/50 mb-1">Bitcoin</div>
          <div className="text-4xl font-bold tabular-nums text-foreground">{formatPrice(price)}</div>
          <div className="flex items-center gap-3 mt-2">
            {ch1d !== undefined && <span className={cn("text-sm font-medium", ch1d >= 0 ? "text-emerald-400" : "text-rose-400")}>{ch1d >= 0 ? "+" : ""}{ch1d.toFixed(1)}% 24h</span>}
            {ch7d !== undefined && <span className={cn("text-sm", ch7d >= 0 ? "text-emerald-400/60" : "text-rose-400/60")}>{ch7d >= 0 ? "+" : ""}{ch7d.toFixed(1)}% 7d</span>}
          </div>
        </div>
      )}

      {mri !== undefined && (
        <div className="mb-5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground/50">Mean Reversion Index</span>
            <span className={cn("text-xs font-medium", mri >= 75 ? "text-rose-400" : mri <= 25 ? "text-emerald-400" : "text-cyan-400")}>
              {mri >= 90 ? "Extreme Overbought" : mri >= 75 ? "Overbought" : mri <= 10 ? "Extreme Oversold" : mri <= 25 ? "Oversold" : "Neutral"}
            </span>
          </div>
          <div className="relative h-2.5 rounded-full bg-border/30 overflow-hidden">
            <div
              className={cn("absolute inset-y-0 left-0 rounded-full transition-all", mri >= 75 ? "bg-rose-500" : mri <= 25 ? "bg-emerald-500" : "bg-cyan-500")}
              style={{ width: `${Math.min(100, Math.max(0, mri))}%` }}
            />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[10px] text-muted-foreground/30">0</span>
            <span className="text-[10px] font-mono font-medium text-muted-foreground/70">{mri.toFixed(1)}</span>
            <span className="text-[10px] text-muted-foreground/30">100</span>
          </div>
        </div>
      )}

      {insight.narrative && (
        <div className="rounded-xl border border-border/20 bg-background/30 p-3 mb-4">
          <p className="text-xs text-muted-foreground/70 leading-relaxed line-clamp-4">{insight.narrative}</p>
        </div>
      )}

      <div className="mt-auto text-center text-xs text-muted-foreground/30">
        {total > 0 ? `Swipe right for ${total} signal${total !== 1 ? "s" : ""}` : "Swipe right for metrics"}
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function MobilePage() {
  const [insight,         setInsight]         = useState<Insight | null>(null)
  const [metricsData,     setMetricsData]     = useState<MobileMetric[]>([])
  const [loading,         setLoading]         = useState(true)
  const [error,           setError]           = useState<string | null>(null)
  const [cardIndex,       setCardIndex]       = useState(0)

  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)
  const [dragging,  setDragging]  = useState(false)
  const [dragX,     setDragX]     = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [insightRes, metricsRes] = await Promise.all([
        fetch(withBase("/api/insights"), { credentials: "include" }),
        fetch(withBase("/api/metrics/mobile"), { credentials: "include" }),
      ])

      if (insightRes.ok) {
        const data: Insight = await insightRes.json()
        setInsight(data)
      } else if (insightRes.status === 404) {
        setError("No insights yet. Tap refresh after triggering generation.")
      } else {
        const b = await insightRes.json().catch(() => ({}))
        setError(b?.error || `HTTP ${insightRes.status}`)
      }

      if (metricsRes.ok) {
        const mData = await metricsRes.json()
        setMetricsData(mData.metrics ?? [])
      }

      setCardIndex(0)
    } catch {
      setError("Could not connect to server.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // card layout: [0]=summary, [1..S]=signals, [S+1..S+M]=metrics
  const signalCount  = insight?.signals.length ?? 0
  const metricCount  = metricsData.length
  const totalCards   = 1 + signalCount + metricCount

  function goTo(idx: number) {
    setCardIndex(Math.min(Math.max(0, idx), totalCards - 1))
  }

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    setDragging(true)
    setDragX(0)
  }

  function onTouchMove(e: React.TouchEvent) {
    if (touchStartX.current === null || touchStartY.current === null) return
    const dx = e.touches[0].clientX - touchStartX.current
    const dy = e.touches[0].clientY - touchStartY.current
    if (Math.abs(dx) > Math.abs(dy)) {
      e.preventDefault()
      setDragX(dx)
    }
  }

  function onTouchEnd() {
    if (dragX > 60) goTo(cardIndex - 1)
    else if (dragX < -60) goTo(cardIndex + 1)
    setDragging(false)
    setDragX(0)
    touchStartX.current = null
    touchStartY.current = null
  }

  function renderCard() {
    if (cardIndex === 0) {
      return insight
        ? <SummaryCard insight={insight} total={signalCount + metricCount} />
        : <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-4">
            <AlertTriangle className="h-10 w-10 text-amber-400/40" />
            <p className="text-sm text-muted-foreground/60">{error ?? "No data"}</p>
          </div>
    }
    if (cardIndex <= signalCount && insight) {
      return <SignalCard signal={insight.signals[cardIndex - 1]} index={cardIndex - 1} total={signalCount} />
    }
    const metricIdx = cardIndex - 1 - signalCount
    if (metricIdx >= 0 && metricIdx < metricCount) {
      return <MetricCard metric={metricsData[metricIdx]} index={metricIdx} total={metricCount} />
    }
    return null
  }

  // section labels for dot groups
  const dotSection = (i: number) =>
    i === 0 ? "summary"
    : i <= signalCount ? "signal"
    : "metric"

  return (
    <div className="h-[100dvh] flex flex-col bg-background select-none">
      <div className="h-[env(safe-area-inset-top,0px)] shrink-0" />

      {/* Top bar */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-1.5">
          <Lightbulb className="h-4 w-4 text-primary/60" />
          <span className="text-xs font-medium text-muted-foreground/60">
            {cardIndex > signalCount && signalCount + metricCount > 0 ? "Metrics" : "Insights"}
          </span>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="p-2 rounded-full text-muted-foreground/40 hover:text-muted-foreground active:bg-accent/30"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>
      </div>

      {/* Card area */}
      <div
        className="flex-1 min-h-0 px-4 pb-2"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{ touchAction: "pan-y" }}
      >
        <div
          className="h-full transition-transform"
          style={{
            transform: dragging ? `translateX(${dragX * 0.3}px)` : "translateX(0)",
            transitionDuration: dragging ? "0ms" : "200ms",
          }}
        >
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary/40" />
              <p className="text-sm text-muted-foreground/50">Loading…</p>
            </div>
          ) : renderCard()}
        </div>
      </div>

      {/* Dot indicators — grouped by section with a gap */}
      {!loading && totalCards > 1 && (
        <div className="shrink-0 flex items-center justify-center gap-px py-2 flex-wrap px-4">
          {Array.from({ length: totalCards }).map((_, i) => {
            const sec = dotSection(i)
            const prevSec = i > 0 ? dotSection(i - 1) : sec
            return (
              <div key={i} className={cn("flex items-center", sec !== prevSec && "ml-2")}>
                <button
                  onClick={() => goTo(i)}
                  className={cn(
                    "rounded-full transition-all",
                    i === cardIndex
                      ? cn("w-5 h-1.5", sec === "metric" ? "bg-cyan-500" : "bg-primary")
                      : "w-1.5 h-1.5 bg-muted-foreground/20"
                  )}
                />
              </div>
            )
          })}
        </div>
      )}

      {/* Nav arrows */}
      {!loading && totalCards > 1 && (
        <div className="shrink-0 hidden sm:flex items-center justify-center gap-4 pb-3">
          <button
            onClick={() => goTo(cardIndex - 1)}
            disabled={cardIndex === 0}
            className="p-2 rounded-full border border-border/30 text-muted-foreground/40 hover:text-muted-foreground disabled:opacity-20 active:bg-accent/30"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={() => goTo(cardIndex + 1)}
            disabled={cardIndex >= totalCards - 1}
            className="p-2 rounded-full border border-border/30 text-muted-foreground/40 hover:text-muted-foreground disabled:opacity-20 active:bg-accent/30"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* Generate button if no insight */}
      {!loading && error?.includes("No insights") && (
        <div className="shrink-0 px-4 pb-4">
          <GenerateButton />
        </div>
      )}

      <div className="h-[env(safe-area-inset-bottom,0px)] shrink-0" />
    </div>
  )
}

function GenerateButton() {
  const [generating, setGenerating] = useState(false)

  async function trigger() {
    setGenerating(true)
    try {
      await fetch(withBase("/api/insights?trigger"), { credentials: "include" })
      setTimeout(() => window.location.reload(), 35000)
    } catch { /* ignore */ } finally {
      setTimeout(() => setGenerating(false), 5000)
    }
  }

  return (
    <button
      onClick={trigger}
      disabled={generating}
      className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-60"
    >
      {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
      {generating ? "Generating…" : "Generate Insights"}
    </button>
  )
}
