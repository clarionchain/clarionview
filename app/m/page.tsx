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

const LEVEL_COLORS = {
  critical: { bg: "bg-rose-500/10", border: "border-rose-500/30", text: "text-rose-400", dot: "bg-rose-500" },
  warning:  { bg: "bg-amber-500/10", border: "border-amber-500/30", text: "text-amber-400", dot: "bg-amber-500" },
  info:     { bg: "bg-cyan-500/10",  border: "border-cyan-500/30",  text: "text-cyan-400",  dot: "bg-cyan-500"  },
}

function formatPrice(n: number) {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function SignalCard({
  signal,
  index,
  total,
}: {
  signal: Signal
  index: number
  total: number
}) {
  const c = LEVEL_COLORS[signal.level]
  const isUp = signal.type.includes("overbought") || signal.type.includes("high") || signal.type.includes("euphoria")
  const isDown = signal.type.includes("oversold") || signal.type.includes("capitulation") || signal.type.includes("loss")

  return (
    <div className={cn("flex flex-col h-full rounded-2xl border p-6", c.bg, c.border)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <span className={cn("text-xs font-medium uppercase tracking-wider", c.text)}>
          {signal.level}
        </span>
        <span className="text-xs text-muted-foreground/40">
          {index + 1} / {total}
        </span>
      </div>

      {/* Icon + metric value */}
      <div className="flex items-center gap-3 mb-5">
        <div className={cn("rounded-xl p-3", c.bg, "border", c.border)}>
          {isUp ? (
            <TrendingUp className={cn("h-6 w-6", c.text)} />
          ) : isDown ? (
            <TrendingDown className={cn("h-6 w-6", c.text)} />
          ) : (
            <Activity className={cn("h-6 w-6", c.text)} />
          )}
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

      {/* Title */}
      <h2 className="text-lg font-semibold text-foreground leading-tight mb-3">{signal.title}</h2>

      {/* Body */}
      <p className="text-sm text-muted-foreground/70 leading-relaxed flex-1">{signal.body}</p>

      {/* Bottom swipe hint */}
      <div className="mt-6 flex items-center justify-center gap-1 opacity-30">
        <ChevronLeft className="h-4 w-4" />
        <span className="text-xs">swipe</span>
        <ChevronRight className="h-4 w-4" />
      </div>
    </div>
  )
}

function SummaryCard({
  insight,
  total,
}: {
  insight: Insight
  total: number
}) {
  const price = insight.snapshot.price
  const mri = insight.snapshot.mri_index
  const ch1d = insight.changes["1d"]
  const ch7d = insight.changes["7d"]

  const critCount = insight.signals.filter((s) => s.level === "critical").length
  const warnCount = insight.signals.filter((s) => s.level === "warning").length

  return (
    <div className="flex flex-col h-full rounded-2xl border border-border/30 bg-card/60 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <Bitcoin className="h-5 w-5 text-orange-400" />
          <span className="text-sm font-semibold">ClarionView</span>
        </div>
        <div className="flex items-center gap-1.5">
          {critCount > 0 && (
            <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-rose-500/15 text-rose-400">
              {critCount} critical
            </span>
          )}
          {warnCount > 0 && (
            <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-amber-500/15 text-amber-400">
              {warnCount} warning
            </span>
          )}
        </div>
      </div>

      {/* Price */}
      {price && (
        <div className="mb-5">
          <div className="text-xs text-muted-foreground/50 mb-1">Bitcoin</div>
          <div className="text-4xl font-bold tabular-nums text-foreground">{formatPrice(price)}</div>
          <div className="flex items-center gap-3 mt-2">
            {ch1d !== undefined && (
              <span className={cn("text-sm font-medium", ch1d >= 0 ? "text-emerald-400" : "text-rose-400")}>
                {ch1d >= 0 ? "+" : ""}{ch1d.toFixed(1)}% 24h
              </span>
            )}
            {ch7d !== undefined && (
              <span className={cn("text-sm", ch7d >= 0 ? "text-emerald-400/60" : "text-rose-400/60")}>
                {ch7d >= 0 ? "+" : ""}{ch7d.toFixed(1)}% 7d
              </span>
            )}
          </div>
        </div>
      )}

      {/* MRI */}
      {mri !== undefined && (
        <div className="mb-5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground/50">Mean Reversion Index</span>
            <span className={cn(
              "text-xs font-medium",
              mri >= 75 ? "text-rose-400" : mri <= 25 ? "text-emerald-400" : "text-cyan-400"
            )}>
              {mri >= 90 ? "Extreme Overbought" :
               mri >= 75 ? "Overbought" :
               mri <= 10 ? "Extreme Oversold" :
               mri <= 25 ? "Oversold" : "Neutral"}
            </span>
          </div>
          <div className="relative h-2.5 rounded-full bg-border/30 overflow-hidden">
            <div
              className={cn(
                "absolute inset-y-0 left-0 rounded-full transition-all",
                mri >= 75 ? "bg-rose-500" : mri <= 25 ? "bg-emerald-500" : "bg-cyan-500"
              )}
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

      {/* Narrative */}
      {insight.narrative && (
        <div className="rounded-xl border border-border/20 bg-background/30 p-3 mb-4">
          <p className="text-xs text-muted-foreground/70 leading-relaxed line-clamp-4">{insight.narrative}</p>
        </div>
      )}

      <div className="mt-auto text-center text-xs text-muted-foreground/30">
        {total > 0 ? `Swipe right for ${total} signal${total !== 1 ? "s" : ""}` : "No signals today"}
      </div>
    </div>
  )
}

export default function MobilePage() {
  const [insight, setInsight] = useState<Insight | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cardIndex, setCardIndex] = useState(0) // 0 = summary, 1+ = signals

  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const [dragX, setDragX] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(withBase("/api/insights"), { credentials: "include" })
      if (!r.ok) {
        if (r.status === 404) {
          setError("No insights yet. Tap refresh after triggering generation.")
        } else {
          const b = await r.json().catch(() => ({}))
          setError(b?.error || `HTTP ${r.status}`)
        }
        return
      }
      const data: Insight = await r.json()
      setInsight(data)
      setCardIndex(0)
    } catch {
      setError("Could not connect to server.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const totalCards = insight ? insight.signals.length + 1 : 1 // +1 for summary card

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
    // Only track horizontal swipes
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

  const currentSignal = insight && cardIndex > 0 ? insight.signals[cardIndex - 1] : null

  return (
    <div className="h-[100dvh] flex flex-col bg-background select-none">
      {/* Status bar spacer for notched phones */}
      <div className="h-[env(safe-area-inset-top,0px)] shrink-0" />

      {/* Top bar */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-1.5">
          <Lightbulb className="h-4 w-4 text-primary/60" />
          <span className="text-xs font-medium text-muted-foreground/60">Insights</span>
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
        className="flex-1 min-h-0 px-4 pb-4"
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
              <p className="text-sm text-muted-foreground/50">Loading insights…</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-4">
              <AlertTriangle className="h-10 w-10 text-amber-400/40" />
              <p className="text-sm text-muted-foreground/60">{error}</p>
              <button
                onClick={load}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-border/40 text-sm text-muted-foreground hover:bg-accent/30 active:bg-accent/50"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Retry
              </button>
            </div>
          ) : insight ? (
            cardIndex === 0 ? (
              <SummaryCard insight={insight} total={insight.signals.length} />
            ) : currentSignal ? (
              <SignalCard signal={currentSignal} index={cardIndex - 1} total={insight.signals.length} />
            ) : null
          ) : null}
        </div>
      </div>

      {/* Dot indicator */}
      {insight && totalCards > 1 && (
        <div className="shrink-0 flex items-center justify-center gap-1.5 py-3">
          {Array.from({ length: totalCards }).map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              className={cn(
                "rounded-full transition-all",
                i === cardIndex
                  ? "w-5 h-1.5 bg-primary"
                  : "w-1.5 h-1.5 bg-muted-foreground/20"
              )}
            />
          ))}
        </div>
      )}

      {/* Nav arrows (tablet/large phones) */}
      {insight && (
        <div className="shrink-0 hidden sm:flex items-center justify-center gap-4 pb-4">
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

      {/* Bottom safe area */}
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
    } catch {
      /* ignore */
    } finally {
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
