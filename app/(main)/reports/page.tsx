"use client"

import { useState, useEffect, useCallback } from "react"
import {
  FileText, Loader2, RefreshCw, AlertCircle,
  ChevronRight, Calendar, Zap, TrendingUp, TrendingDown, Minus, Download,
} from "lucide-react"
import ReactMarkdown from "react-markdown"
import { withBase } from "@/lib/base-path"
import { cn } from "@/lib/utils"

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReportMeta {
  date: string
  generated_at: string | null
  status: string
}

interface MetricRow {
  label: string
  value: number | null
  value_fmt: string
  zscore: number | null
  percentile: number | null
}

interface PriceBlock {
  value: number | null
  change_1d: number | null
  change_7d: number | null
  change_30d: number | null
  rsi: number | null
  vs_200dma_pct: number | null
}

interface EtfRow {
  ticker: string
  price: number
  change_1d: number | null
  change_30d: number | null
}

interface MacroRow {
  label: string
  value: number
  value_fmt: string
  change_yoy: number | null
}

interface StructuredReport {
  price: PriceBlock
  onchain: MetricRow[]
  pricing: MetricRow[]
  supply: MetricRow[]
  mining: MetricRow[]
  etf: EtfRow[]
  macro: MacroRow[]
}

interface ReportFull extends ReportMeta {
  narrative: string
  structured: StructuredReport | null
  data_snapshot: string
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function formatDate(dateStr: string) {
  return new Date(dateStr + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
  })
}

function formatGenerated(iso: string | null) {
  if (!iso) return "Unknown"
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZoneName: "short" })
}

function changeColor(val: number | null | undefined): string {
  if (val == null) return "text-muted-foreground/50"
  return val > 0 ? "text-emerald-400" : val < 0 ? "text-rose-400" : "text-muted-foreground/50"
}

function pctBarColor(pct: number | null): string {
  if (pct === null) return "bg-muted/20"
  if (pct >= 85) return "bg-rose-500"
  if (pct >= 65) return "bg-amber-500"
  if (pct <= 15) return "bg-emerald-500"
  if (pct <= 35) return "bg-sky-500"
  return "bg-muted-foreground/30"
}

function pctTextColor(pct: number | null): string {
  if (pct === null) return "text-muted-foreground/60"
  if (pct >= 85) return "text-rose-400"
  if (pct >= 65) return "text-amber-400"
  if (pct <= 15) return "text-emerald-400"
  if (pct <= 35) return "text-sky-400"
  return "text-muted-foreground/70"
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ChangeChip({ label, value }: { label: string; value: number | null }) {
  if (value == null) return null
  const Icon = value > 0 ? TrendingUp : value < 0 ? TrendingDown : Minus
  return (
    <div className={cn("flex items-center gap-1 text-[11px] font-medium", changeColor(value))}>
      <Icon className="h-3 w-3" />
      <span className="text-muted-foreground/40 mr-0.5">{label}</span>
      {value > 0 ? "+" : ""}{value}%
    </div>
  )
}

function MetricCard({ m }: { m: MetricRow }) {
  if (m.value === null) return null
  return (
    <div className="bg-card/40 border border-border/20 rounded-lg p-3 flex flex-col gap-2">
      <div className="text-[10px] text-muted-foreground/50 font-medium uppercase tracking-wide truncate">{m.label}</div>
      <div className={cn("text-sm font-semibold tabular-nums", pctTextColor(m.percentile))}>{m.value_fmt}</div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1 bg-muted/20 rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full", pctBarColor(m.percentile))}
            style={{ width: `${m.percentile ?? 0}%` }}
          />
        </div>
        {m.percentile !== null && (
          <span className={cn("text-[10px] tabular-nums shrink-0", pctTextColor(m.percentile))}>
            {Math.round(m.percentile)}th
          </span>
        )}
      </div>
      {m.zscore !== null && (
        <div className="text-[10px] text-muted-foreground/40 tabular-nums">
          z = {m.zscore > 0 ? "+" : ""}{m.zscore.toFixed(2)}σ
        </div>
      )}
    </div>
  )
}

function MetricGrid({ title, metrics }: { title: string; metrics: MetricRow[] }) {
  const visible = metrics.filter((m) => m.value !== null)
  if (!visible.length) return null
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground/30 font-semibold mb-2">{title}</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {visible.map((m) => <MetricCard key={m.label} m={m} />)}
      </div>
    </div>
  )
}

function ReportInfographic({ report }: { report: ReportFull }) {
  const [imgError, setImgError] = useState(false)
  const [showDetail, setShowDetail] = useState(false)
  const s = report.structured
  const p = s?.price
  const narrativeUnavailable = report.narrative?.startsWith("*LLM narrative unavailable")
  const infographicUrl = withBase(`/api/reports/${report.date}/infographic.png`)

  return (
    <div className="space-y-4 pb-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">{formatDate(report.date)}</h1>
          {report.generated_at && (
            <p className="text-xs text-muted-foreground/40 mt-0.5">Generated {formatGenerated(report.generated_at)}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {report.status === "error" && (
            <span className="flex items-center gap-1 text-xs text-rose-400/80 border border-rose-400/20 rounded px-2 py-1">
              <AlertCircle className="h-3 w-3" />Error
            </span>
          )}
          <a
            href={infographicUrl}
            download={`${report.date}_report.png`}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-border/40 bg-card/60 text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
          >
            <Download className="h-3 w-3" />
            PNG
          </a>
        </div>
      </div>

      {/* ── Infographic PNG (primary visual) ── */}
      {!imgError ? (
        <div className="rounded-xl overflow-hidden border border-border/20 bg-card/20">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={infographicUrl}
            alt={`Report infographic for ${report.date}`}
            className="w-full h-auto block"
            onError={() => setImgError(true)}
          />
        </div>
      ) : (
        /* Fallback: structured metric cards */
        <>
          {p?.value && (
            <div className="rounded-xl border border-border/25 bg-gradient-to-br from-card/60 to-card/20 p-4">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground/30 font-semibold mb-2">Bitcoin</div>
              <div className="flex items-end gap-4 flex-wrap">
                <div className="text-3xl font-bold tabular-nums">${p.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                <div className="flex gap-3 flex-wrap pb-0.5">
                  <ChangeChip label="1d" value={p.change_1d} />
                  <ChangeChip label="7d" value={p.change_7d} />
                  <ChangeChip label="30d" value={p.change_30d} />
                </div>
              </div>
              <div className="flex gap-4 mt-2 flex-wrap">
                {p.rsi != null && (
                  <div className="text-[11px] text-muted-foreground/50">
                    RSI(14) <span className="font-medium text-foreground/70 ml-1">{p.rsi}</span>
                  </div>
                )}
                {p.vs_200dma_pct != null && (
                  <div className={cn("text-[11px]", changeColor(p.vs_200dma_pct))}>
                    vs 200DMA <span className="font-medium ml-1">{p.vs_200dma_pct > 0 ? "+" : ""}{p.vs_200dma_pct}%</span>
                  </div>
                )}
              </div>
            </div>
          )}
          {s && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="space-y-4">
                <MetricGrid title="On-Chain Valuation" metrics={s.onchain} />
                <MetricGrid title="Pricing Models" metrics={s.pricing} />
              </div>
              <div className="space-y-4">
                <MetricGrid title="Supply Dynamics" metrics={s.supply} />
                <MetricGrid title="Mining Health" metrics={s.mining} />
              </div>
            </div>
          )}
        </>
      )}

      {/* ── AI narrative (below infographic) ── */}
      {!narrativeUnavailable && report.narrative && (
        <div className="rounded-xl border border-border/25 bg-card/30 p-4">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground/30 font-semibold mb-3">AI Analysis</div>
          <div className="prose prose-sm prose-invert max-w-none text-foreground/80 leading-relaxed text-[13px]">
            <ReactMarkdown>{report.narrative}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* ── Detail metrics toggle ── */}
      {s && (
        <div className="rounded-lg border border-border/15 overflow-hidden">
          <button
            onClick={() => setShowDetail((v) => !v)}
            className="flex items-center gap-2 w-full px-4 py-2 text-xs text-muted-foreground/40 hover:text-muted-foreground hover:bg-accent/20 transition-colors text-left"
          >
            <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", showDetail && "rotate-90")} />
            Detailed Metrics
          </button>
          {showDetail && (
            <div className="px-4 pb-4 pt-2 border-t border-border/15 space-y-4">
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="space-y-4">
                  <MetricGrid title="On-Chain Valuation" metrics={s.onchain} />
                  <MetricGrid title="Pricing Models" metrics={s.pricing} />
                </div>
                <div className="space-y-4">
                  <MetricGrid title="Supply Dynamics" metrics={s.supply} />
                  <MetricGrid title="Mining Health" metrics={s.mining} />
                  {s.etf.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground/30 font-semibold mb-2">ETF & Equities</div>
                      <div className="rounded-lg border border-border/20 overflow-hidden">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-border/15 bg-card/30">
                              <th className="text-left px-3 py-2 text-muted-foreground/40 font-medium">Ticker</th>
                              <th className="text-right px-3 py-2 text-muted-foreground/40 font-medium">Price</th>
                              <th className="text-right px-3 py-2 text-muted-foreground/40 font-medium">1d</th>
                              <th className="text-right px-3 py-2 text-muted-foreground/40 font-medium">30d</th>
                            </tr>
                          </thead>
                          <tbody>
                            {s.etf.map((row) => (
                              <tr key={row.ticker} className="border-b border-border/10 last:border-0">
                                <td className="px-3 py-2 font-medium text-foreground/80">{row.ticker}</td>
                                <td className="px-3 py-2 text-right tabular-nums text-foreground/70">${row.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td className={cn("px-3 py-2 text-right tabular-nums", changeColor(row.change_1d))}>
                                  {row.change_1d != null ? `${row.change_1d > 0 ? "+" : ""}${row.change_1d}%` : "—"}
                                </td>
                                <td className={cn("px-3 py-2 text-right tabular-nums", changeColor(row.change_30d))}>
                                  {row.change_30d != null ? `${row.change_30d > 0 ? "+" : ""}${row.change_30d}%` : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {s.macro.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground/30 font-semibold mb-2">Macro</div>
                      <div className="grid grid-cols-2 gap-2">
                        {s.macro.map((row) => (
                          <div key={row.label} className="bg-card/40 border border-border/20 rounded-lg p-3">
                            <div className="text-[10px] text-muted-foreground/40 uppercase tracking-wide">{row.label}</div>
                            <div className="text-sm font-semibold text-foreground/80 mt-1">{row.value_fmt}</div>
                            {row.change_yoy != null && (
                              <div className={cn("text-[10px] mt-0.5", changeColor(row.change_yoy))}>
                                YoY {row.change_yoy > 0 ? "+" : ""}{row.change_yoy}%
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const [reports, setReports] = useState<ReportMeta[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [report, setReport] = useState<ReportFull | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [triggering, setTriggering] = useState(false)

  const loadList = useCallback(async () => {
    setListLoading(true)
    setListError(null)
    try {
      const r = await fetch(withBase("/api/reports"), { credentials: "include" })
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        throw new Error((body as { error?: string })?.error || `HTTP ${r.status}`)
      }
      const data: ReportMeta[] = await r.json()
      setReports(data)
      if (data.length > 0 && !selectedDate) setSelectedDate(data[0].date)
    } catch (e: unknown) {
      setListError(e instanceof Error ? e.message : "Failed to load reports")
    } finally {
      setListLoading(false)
    }
  }, [selectedDate])

  useEffect(() => { loadList() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedDate) return
    setReportLoading(true)
    setReport(null)
    fetch(withBase(`/api/reports?date=${encodeURIComponent(selectedDate)}`), { credentials: "include" })
      .then((r) => {
        if (!r.ok) return r.json().then((b) => Promise.reject(new Error((b as { error?: string })?.error || `HTTP ${r.status}`)))
        return r.json()
      })
      .then((data: ReportFull) => setReport(data))
      .catch((e: Error) => {
        setReport({ date: selectedDate, generated_at: null, status: "error", narrative: `*Failed: ${e.message}*`, structured: null, data_snapshot: "" })
      })
      .finally(() => setReportLoading(false))
  }, [selectedDate])

  const triggerReport = async () => {
    setTriggering(true)
    try {
      const r = await fetch(withBase("/api/reports?trigger"), { credentials: "include" })
      const body = await r.json().catch(() => ({}))
      if ((body as { status?: string })?.status === "already_generating") {
        alert("A report is already being generated. Check back in a few minutes.")
      } else {
        alert("Report generation started. It will appear when complete (2–5 minutes).")
      }
      setTimeout(() => loadList(), 10000)
    } catch {
      alert("Failed to trigger report — check that the analytics service is running.")
    } finally {
      setTriggering(false)
    }
  }

  return (
    <div className="flex flex-col h-full gap-0 -m-4 lg:-m-6">
      {/* Toolbar */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/30 bg-card/80 px-4 backdrop-blur-md">
        <FileText className="h-4 w-4 text-muted-foreground/50" />
        <span className="text-sm font-medium">Overnight Reports</span>
        <div className="flex-1" />
        <button onClick={loadList} disabled={listLoading} className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent/30 rounded transition-colors">
          <RefreshCw className={cn("h-3.5 w-3.5", listLoading && "animate-spin")} />
        </button>
        <button onClick={triggerReport} disabled={triggering} className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground/50 hover:text-foreground hover:bg-accent/30 rounded transition-colors border border-border/30">
          {triggering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
          Generate Now
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <div className="w-48 shrink-0 border-r border-border/30 overflow-y-auto bg-card/20">
          {listLoading ? (
            <div className="flex items-center gap-2 px-4 py-6 text-xs text-muted-foreground/50">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading...
            </div>
          ) : listError ? (
            <div className="px-4 py-6 space-y-2">
              <div className="flex items-center gap-1.5 text-xs text-rose-400/80">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />Service unavailable
              </div>
              <p className="text-[11px] text-muted-foreground/40 leading-relaxed">
                Ensure the analytics service is running.
              </p>
            </div>
          ) : reports.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <FileText className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground/40">No reports yet.</p>
              <p className="text-[11px] text-muted-foreground/30 mt-1">Click &ldquo;Generate Now&rdquo; to create the first one.</p>
            </div>
          ) : (
            <div className="py-1">
              {reports.map((r) => (
                <button
                  key={r.date}
                  onClick={() => setSelectedDate(r.date)}
                  className={cn(
                    "flex items-center gap-2 w-full px-3 py-2.5 text-left transition-colors",
                    selectedDate === r.date
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/30 hover:text-foreground"
                  )}
                >
                  <Calendar className="h-3.5 w-3.5 shrink-0 opacity-50" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{r.date}</div>
                    {r.generated_at && (
                      <div className="text-[10px] opacity-40 truncate">{formatGenerated(r.generated_at)}</div>
                    )}
                  </div>
                  {r.status === "error" && <AlertCircle className="h-3 w-3 shrink-0 text-rose-400/70" />}
                  <ChevronRight className="h-3 w-3 shrink-0 opacity-30" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 overflow-y-auto px-5 py-4">
          {!selectedDate ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground/30 gap-3">
              <FileText className="h-12 w-12 opacity-30" />
              <p className="text-sm">Select a report from the list</p>
            </div>
          ) : reportLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground/50">
              <Loader2 className="h-4 w-4 animate-spin" />Loading report...
            </div>
          ) : report ? (
            <ReportInfographic report={report} />
          ) : null}
        </div>
      </div>
    </div>
  )
}
