"use client"

import { useState, useEffect, useCallback } from "react"
import {
  Lightbulb, Loader2, RefreshCw, AlertCircle, Zap,
  TrendingUp, TrendingDown, Activity, ChevronRight, Calendar, Download,
} from "lucide-react"
import ReactMarkdown from "react-markdown"
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

interface InsightMeta {
  date: string
  generated_at: string | null
  signal_count: number
  status: string
}

interface InsightFull extends InsightMeta {
  signals: Signal[]
  snapshot: Record<string, number>
  changes: Record<string, number>
  narrative: string
}

const LEVEL_STYLES = {
  critical: {
    card: "border-rose-500/30 bg-rose-500/5",
    badge: "bg-rose-500/15 text-rose-400 border-rose-500/20",
    icon: "text-rose-400",
  },
  warning: {
    card: "border-amber-500/30 bg-amber-500/5",
    badge: "bg-amber-500/15 text-amber-400 border-amber-500/20",
    icon: "text-amber-400",
  },
  info: {
    card: "border-cyan-500/30 bg-cyan-500/5",
    badge: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
    icon: "text-cyan-400",
  },
}

function SignalIcon({ type }: { type: string }) {
  if (type.includes("overbought") || type.includes("high") || type.includes("euphoria") || type.includes("surge"))
    return <TrendingUp className="h-4 w-4" />
  if (type.includes("oversold") || type.includes("capitulation") || type.includes("drop") || type.includes("loss"))
    return <TrendingDown className="h-4 w-4" />
  return <Activity className="h-4 w-4" />
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00Z")
  return d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })
}

function formatValue(metric: string, value: number): string {
  if (metric === "price") return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  if (metric.includes("mri")) return `${value.toFixed(1)}`
  if (value > 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 })
  return value.toFixed(value < 10 ? 4 : 2)
}

export default function InsightsPage() {
  const [list, setList] = useState<InsightMeta[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [insight, setInsight] = useState<InsightFull | null>(null)
  const [insightLoading, setInsightLoading] = useState(false)
  const [triggering, setTriggering] = useState(false)

  const loadList = useCallback(async () => {
    setListLoading(true)
    setListError(null)
    try {
      const r = await fetch(withBase("/api/insights?list"), { credentials: "include" })
      if (!r.ok) {
        const b = await r.json().catch(() => ({}))
        throw new Error(b?.error || `HTTP ${r.status}`)
      }
      const data: InsightMeta[] = await r.json()
      setList(data)
      if (data.length > 0 && !selectedDate) setSelectedDate(data[0].date)
    } catch (e: unknown) {
      setListError(e instanceof Error ? e.message : "Failed to load insights")
    } finally {
      setListLoading(false)
    }
  }, [selectedDate])

  useEffect(() => { loadList() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  useEffect(() => {
    if (!selectedDate) return
    setInsightLoading(true)
    setInsight(null)
    fetch(withBase(`/api/insights?date=${encodeURIComponent(selectedDate)}`), { credentials: "include" })
      .then((r) => {
        if (!r.ok) return r.json().then((b) => Promise.reject(new Error(b?.error || `HTTP ${r.status}`)))
        return r.json()
      })
      .then((data: InsightFull) => setInsight(data))
      .catch((e: Error) => {
        setInsight({
          date: selectedDate, generated_at: null, signal_count: 0, status: "error",
          signals: [], snapshot: {}, changes: {}, narrative: `Failed: ${e.message}`,
        })
      })
      .finally(() => setInsightLoading(false))
  }, [selectedDate])

  const triggerInsights = async () => {
    setTriggering(true)
    try {
      const r = await fetch(withBase("/api/insights?trigger"), { credentials: "include" })
      const body = await r.json().catch(() => ({}))
      if (body?.status === "already_generating") {
        alert("Insights are already being generated.")
      } else {
        alert("Insights generation started. Check back in ~30 seconds.")
        setTimeout(() => loadList(), 35000)
      }
    } catch {
      alert("Failed to trigger — check analytics service.")
    } finally {
      setTriggering(false)
    }
  }

  const criticalCount = insight?.signals.filter((s) => s.level === "critical").length ?? 0
  const warningCount = insight?.signals.filter((s) => s.level === "warning").length ?? 0

  return (
    <div className="flex flex-col h-full gap-0 -m-4 lg:-m-6">
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/30 bg-card/80 px-4 backdrop-blur-md">
        <Lightbulb className="h-4 w-4 text-muted-foreground/50" />
        <span className="text-sm font-medium">Insights</span>
        <div className="flex-1" />
        <button
          onClick={loadList}
          disabled={listLoading}
          className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent/30 rounded transition-colors"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", listLoading && "animate-spin")} />
        </button>
        <button
          onClick={triggerInsights}
          disabled={triggering}
          className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground/50 hover:text-foreground hover:bg-accent/30 rounded transition-colors border border-border/30"
        >
          {triggering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
          Generate Now
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* List sidebar */}
        <div className="w-48 shrink-0 border-r border-border/30 overflow-y-auto bg-card/20">
          {listLoading ? (
            <div className="flex items-center gap-2 px-4 py-6 text-xs text-muted-foreground/50">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading...
            </div>
          ) : listError ? (
            <div className="px-4 py-6 space-y-2">
              <div className="flex items-center gap-1.5 text-xs text-rose-400/80">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                Service unavailable
              </div>
              <p className="text-[11px] text-muted-foreground/40 leading-relaxed">{listError}</p>
            </div>
          ) : list.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Lightbulb className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground/40">No insights yet.</p>
              <p className="text-[11px] text-muted-foreground/30 mt-1">Click &ldquo;Generate Now&rdquo;.</p>
            </div>
          ) : (
            <div className="py-1">
              {list.map((item) => (
                <button
                  key={item.date}
                  onClick={() => setSelectedDate(item.date)}
                  className={cn(
                    "flex items-center gap-2 w-full px-3 py-2.5 text-left transition-colors",
                    selectedDate === item.date
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/30 hover:text-foreground"
                  )}
                >
                  <Calendar className="h-3.5 w-3.5 shrink-0 opacity-50" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{item.date}</div>
                    <div className="text-[10px] opacity-50">{item.signal_count} signal{item.signal_count !== 1 ? "s" : ""}</div>
                  </div>
                  <ChevronRight className="h-3 w-3 shrink-0 opacity-30" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Detail */}
        <div className="flex-1 min-w-0 overflow-y-auto p-6">
          {!selectedDate ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground/30 gap-3">
              <Lightbulb className="h-12 w-12 opacity-30" />
              <p className="text-sm">Select a date from the list</p>
            </div>
          ) : insightLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground/50">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading insights...
            </div>
          ) : insight ? (
            <div className="max-w-2xl space-y-5">
              {/* Date + summary badges */}
              <div className="flex items-start justify-between gap-4">
                <h1 className="text-xl font-semibold">{formatDate(insight.date)}</h1>
                <div className="flex items-center gap-1.5 shrink-0">
                  {criticalCount > 0 && (
                    <span className="rounded px-2 py-0.5 text-xs border border-rose-500/20 bg-rose-500/10 text-rose-400">
                      {criticalCount} critical
                    </span>
                  )}
                  {warningCount > 0 && (
                    <span className="rounded px-2 py-0.5 text-xs border border-amber-500/20 bg-amber-500/10 text-amber-400">
                      {warningCount} warning
                    </span>
                  )}
                  <a
                    href={`/api/insights/${insight.date}/infographic.png`}
                    download={`${insight.date}_btc_insight.png`}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-border/40 bg-card/60 text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
                  >
                    <Download className="h-3 w-3" />
                    PNG
                  </a>
                </div>
              </div>

              {/* Price snapshot */}
              {insight.snapshot.price && (
                <div className="flex flex-wrap gap-3">
                  <div className="rounded-lg border border-border/30 bg-card/40 px-4 py-3 text-center min-w-[100px]">
                    <div className="text-xs text-muted-foreground/50 mb-1">BTC Price</div>
                    <div className="text-sm font-semibold">
                      ${insight.snapshot.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </div>
                  </div>
                  {Object.entries(insight.changes).map(([period, pct]) => (
                    <div key={period} className="rounded-lg border border-border/30 bg-card/40 px-4 py-3 text-center min-w-[80px]">
                      <div className="text-xs text-muted-foreground/50 mb-1">{period}</div>
                      <div className={cn("text-sm font-semibold", pct >= 0 ? "text-emerald-400" : "text-rose-400")}>
                        {pct >= 0 ? "+" : ""}{pct.toFixed(1)}%
                      </div>
                    </div>
                  ))}
                  {insight.snapshot.mri_index !== undefined && (
                    <div className="rounded-lg border border-border/30 bg-card/40 px-4 py-3 text-center min-w-[80px]">
                      <div className="text-xs text-muted-foreground/50 mb-1">MRI</div>
                      <div className="text-sm font-semibold">{insight.snapshot.mri_index.toFixed(1)}</div>
                    </div>
                  )}
                </div>
              )}

              {/* LLM narrative */}
              {insight.narrative && (
                <div className="rounded-lg border border-border/30 bg-card/40 p-4">
                  <div className="text-xs text-muted-foreground/50 mb-2 font-medium">AI Summary</div>
                  <div className="prose prose-sm prose-invert max-w-none text-foreground/90 leading-relaxed">
                    <ReactMarkdown>{insight.narrative}</ReactMarkdown>
                  </div>
                </div>
              )}

              {/* Signals */}
              {insight.signals.length === 0 ? (
                <p className="text-sm text-muted-foreground/50">No significant signals detected.</p>
              ) : (
                <div className="space-y-3">
                  {(["critical", "warning", "info"] as const).map((level) => {
                    const sigs = insight.signals.filter((s) => s.level === level)
                    if (sigs.length === 0) return null
                    return (
                      <div key={level}>
                        <div className="text-xs font-medium text-muted-foreground/50 mb-2 uppercase tracking-wider">
                          {level}
                        </div>
                        <div className="space-y-2">
                          {sigs.map((sig) => {
                            const styles = LEVEL_STYLES[level]
                            return (
                              <div
                                key={sig.type}
                                className={cn("rounded-lg border p-4", styles.card)}
                              >
                                <div className="flex items-start gap-3">
                                  <div className={cn("mt-0.5 shrink-0", styles.icon)}>
                                    <SignalIcon type={sig.type} />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="text-sm font-medium text-foreground">{sig.title}</span>
                                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-mono", styles.badge)}>
                                        {formatValue(sig.metric, sig.value)}
                                      </span>
                                    </div>
                                    <p className="text-xs text-muted-foreground/70 leading-relaxed">{sig.body}</p>
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
