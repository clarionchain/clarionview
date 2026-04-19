"use client"

import { useState, useEffect, useCallback } from "react"
import {
  FileText, Loader2, RefreshCw, AlertCircle,
  ChevronLeft, ChevronRight, Zap, TrendingUp, TrendingDown, Minus, Download,
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(dateStr: string) {
  return new Date(dateStr + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
  })
}

function formatGenerated(iso: string | null) {
  if (!iso) return "Unknown"
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZoneName: "short" })
}

function pctBarColor(pct: number | null): string {
  if (pct === null) return "bg-muted/20"
  if (pct >= 85) return "bg-rose-500"
  if (pct >= 65) return "bg-amber-500"
  if (pct <= 15) return "bg-emerald-500"
  if (pct <= 35) return "bg-sky-500"
  return "bg-zinc-500/60"
}

function pctTextColor(pct: number | null): string {
  if (pct === null) return "text-muted-foreground/50"
  if (pct >= 85) return "text-rose-400"
  if (pct >= 65) return "text-amber-400"
  if (pct <= 15) return "text-emerald-400"
  if (pct <= 35) return "text-sky-400"
  return "text-foreground/70"
}

function changeColor(val: number | null | undefined): string {
  if (val == null) return "text-muted-foreground/50"
  return val > 0 ? "text-emerald-400" : val < 0 ? "text-rose-400" : "text-muted-foreground/50"
}

// ─── RSI Gauge ───────────────────────────────────────────────────────────────

function RsiGauge({ rsi }: { rsi: number }) {
  // Semicircle arc from 180° (left) to 0° (right), value 0–100
  const pct = Math.min(1, Math.max(0, rsi / 100))
  const angle = 180 - pct * 180          // degrees from left (180°) to right (0°)
  const rad = (angle * Math.PI) / 180
  const cx = 44, cy = 44, r = 34
  const nx = cx + r * Math.cos(rad)
  const ny = cy - r * Math.sin(rad)

  // Track colors: green 0-30, yellow 30-70, red 70-100
  const needleColor = rsi >= 70 ? "#f87171" : rsi <= 30 ? "#34d399" : "#facc15"

  return (
    <svg width="88" height="52" viewBox="0 0 88 52" className="overflow-visible">
      {/* Background arc */}
      <path d="M10,44 A34,34 0 0,1 78,44" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" strokeLinecap="round" />
      {/* Green zone 0-30 */}
      <path d="M10,44 A34,34 0 0,1 27.4,18.6" fill="none" stroke="#34d399" strokeWidth="6" strokeLinecap="round" opacity="0.35" />
      {/* Yellow zone 30-70 */}
      <path d="M27.4,18.6 A34,34 0 0,1 60.6,18.6" fill="none" stroke="#facc15" strokeWidth="6" strokeLinecap="round" opacity="0.35" />
      {/* Red zone 70-100 */}
      <path d="M60.6,18.6 A34,34 0 0,1 78,44" fill="none" stroke="#f87171" strokeWidth="6" strokeLinecap="round" opacity="0.35" />
      {/* Needle */}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={needleColor} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="3" fill={needleColor} />
      {/* Labels */}
      <text x="6" y="52" fontSize="8" fill="rgba(255,255,255,0.25)" textAnchor="middle">0</text>
      <text x="44" y="10" fontSize="8" fill="rgba(255,255,255,0.25)" textAnchor="middle">50</text>
      <text x="82" y="52" fontSize="8" fill="rgba(255,255,255,0.25)" textAnchor="middle">100</text>
    </svg>
  )
}

// ─── Price Hero ───────────────────────────────────────────────────────────────

function PriceHero({ p }: { p: PriceBlock }) {
  if (!p.value) return null
  const price = p.value.toLocaleString(undefined, { maximumFractionDigits: 0 })

  function ChangeChip({ label, val }: { label: string; val: number | null }) {
    if (val == null) return null
    const Icon = val > 0 ? TrendingUp : val < 0 ? TrendingDown : Minus
    return (
      <div className={cn("flex items-center gap-1 text-xs font-medium", changeColor(val))}>
        <Icon className="h-3 w-3 shrink-0" />
        <span className="text-muted-foreground/40 text-[10px]">{label}</span>
        {val > 0 ? "+" : ""}{val}%
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border/25 bg-gradient-to-br from-card/80 to-card/30 p-5 flex items-center justify-between gap-6 flex-wrap">
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground/30 font-semibold mb-1">BTC / USD</div>
        <div className="text-4xl font-bold tabular-nums text-foreground">${price}</div>
        <div className="flex items-center gap-4 mt-2 flex-wrap">
          <ChangeChip label="24h" val={p.change_1d} />
          <ChangeChip label="7d" val={p.change_7d} />
          <ChangeChip label="30d" val={p.change_30d} />
          {p.vs_200dma_pct != null && (
            <div className={cn("text-xs font-medium", changeColor(p.vs_200dma_pct))}>
              <span className="text-muted-foreground/40 text-[10px] mr-1">vs 200DMA</span>
              {p.vs_200dma_pct > 0 ? "+" : ""}{p.vs_200dma_pct}%
            </div>
          )}
        </div>
      </div>
      {p.rsi != null && (
        <div className="flex flex-col items-center gap-0.5 shrink-0">
          <RsiGauge rsi={p.rsi} />
          <div className="text-[10px] text-muted-foreground/40 -mt-1">
            RSI(14) <span className={cn("font-semibold", p.rsi >= 70 ? "text-rose-400" : p.rsi <= 30 ? "text-emerald-400" : "text-amber-400")}>{p.rsi}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Metric Row ───────────────────────────────────────────────────────────────

function MetricRowItem({ m }: { m: MetricRow }) {
  if (m.value === null) return null
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border/8 last:border-0">
      <div className="w-36 shrink-0 text-xs text-muted-foreground/55 truncate">{m.label}</div>
      <div className={cn("w-20 shrink-0 text-sm font-semibold tabular-nums text-right", pctTextColor(m.percentile))}>
        {m.value_fmt}
      </div>
      <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full", pctBarColor(m.percentile))}
          style={{ width: `${m.percentile ?? 0}%` }}
        />
      </div>
      <div className={cn("w-10 shrink-0 text-xs text-right tabular-nums font-medium", pctTextColor(m.percentile))}>
        {m.percentile != null ? `${Math.round(m.percentile)}th` : "—"}
      </div>
    </div>
  )
}

function MetricSection({ title, metrics }: { title: string; metrics: MetricRow[] }) {
  const visible = metrics.filter((m) => m.value !== null)
  if (!visible.length) return null
  return (
    <div className="rounded-xl border border-border/20 bg-card/30 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border/15 bg-card/40">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground/40 font-semibold">{title}</span>
      </div>
      <div className="px-4">
        {visible.map((m) => <MetricRowItem key={m.label} m={m} />)}
      </div>
    </div>
  )
}

// ─── ETF Strip ────────────────────────────────────────────────────────────────

function EtfStrip({ etfs }: { etfs: EtfRow[] }) {
  if (!etfs.length) return null
  return (
    <div className="rounded-xl border border-border/20 bg-card/30 p-4">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground/40 font-semibold mb-3">ETF & Equities</div>
      <div className="flex flex-wrap gap-3">
        {etfs.map((e) => (
          <div key={e.ticker} className="flex items-center gap-2 bg-card/50 border border-border/20 rounded-lg px-3 py-2 min-w-[90px]">
            <div>
              <div className="text-xs font-semibold text-foreground/80">{e.ticker}</div>
              <div className="text-[11px] text-muted-foreground/50 tabular-nums">${e.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
            {e.change_1d != null && (
              <div className={cn("text-xs font-medium ml-auto tabular-nums", changeColor(e.change_1d))}>
                {e.change_1d > 0 ? "+" : ""}{e.change_1d}%
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Infographic ─────────────────────────────────────────────────────────────

function ReportInfographic({ report }: { report: ReportFull }) {
  const s = report.structured
  const narrativeUnavailable = report.narrative?.startsWith("*LLM narrative unavailable")
  const infographicUrl = withBase(`/api/reports/${report.date}/infographic.png`)

  return (
    <div className="space-y-3 pb-8">
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
            <Download className="h-3 w-3" />PNG
          </a>
        </div>
      </div>

      {/* Price hero */}
      {s?.price && <PriceHero p={s.price} />}

      {/* Metric sections — 2 col on large screens */}
      {s && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <MetricSection title="On-Chain Valuation" metrics={s.onchain} />
          <MetricSection title="Pricing Models" metrics={s.pricing} />
          <MetricSection title="Supply Dynamics" metrics={s.supply} />
          <MetricSection title="Mining" metrics={s.mining} />
        </div>
      )}

      {/* ETF strip */}
      {s?.etf && s.etf.length > 0 && <EtfStrip etfs={s.etf} />}

      {/* AI narrative */}
      {!narrativeUnavailable && report.narrative && (
        <div className="rounded-xl border border-border/25 bg-card/30 p-4">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground/30 font-semibold mb-3">AI Analysis</div>
          <div className="prose prose-sm prose-invert max-w-none text-foreground/75 leading-relaxed text-[13px]">
            <ReactMarkdown>{report.narrative}</ReactMarkdown>
          </div>
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
  const [selectedIndex, setSelectedIndex] = useState(0)
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
      setSelectedIndex(0)
    } catch (e: unknown) {
      setListError(e instanceof Error ? e.message : "Failed to load reports")
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => { loadList() }, [loadList])

  const selectedDate = reports[selectedIndex]?.date ?? null

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
    <div className="space-y-5">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {reports.length > 1 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setSelectedIndex((i) => Math.min(i + 1, reports.length - 1))}
                disabled={selectedIndex >= reports.length - 1}
                className="p-1 rounded text-muted-foreground/40 hover:text-foreground hover:bg-accent/30 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs text-muted-foreground/50 tabular-nums w-20 text-center">{selectedDate}</span>
              <button
                onClick={() => setSelectedIndex((i) => Math.max(i - 1, 0))}
                disabled={selectedIndex <= 0}
                className="p-1 rounded text-muted-foreground/40 hover:text-foreground hover:bg-accent/30 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
          {listLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/40" />}
          {listError && (
            <div className="flex items-center gap-1.5 text-xs text-rose-400/80">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />Service unavailable
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadList} disabled={listLoading} className="p-1.5 rounded text-muted-foreground/40 hover:text-foreground hover:bg-accent/30 transition-colors">
            <RefreshCw className={cn("h-3.5 w-3.5", listLoading && "animate-spin")} />
          </button>
          <button onClick={triggerReport} disabled={triggering} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground/60 hover:text-foreground hover:bg-accent/30 rounded border border-border/40 transition-colors">
            {triggering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
            Generate Now
          </button>
        </div>
      </div>

      {/* Content */}
      {listLoading && !report ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground/50 py-12 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />Loading...
        </div>
      ) : reports.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground/30">
          <FileText className="h-12 w-12 opacity-30" />
          <p className="text-sm">No reports yet.</p>
          <p className="text-xs">Click &ldquo;Generate Now&rdquo; to create the first one.</p>
        </div>
      ) : reportLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground/50 py-12 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />Loading report...
        </div>
      ) : report ? (
        <ReportInfographic report={report} />
      ) : null}
    </div>
  )
}
