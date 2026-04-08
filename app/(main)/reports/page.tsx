"use client"

import { useState, useEffect, useCallback } from "react"
import { FileText, Loader2, RefreshCw, AlertCircle, ChevronRight, Calendar, Zap } from "lucide-react"
import ReactMarkdown from "react-markdown"
import { withBase } from "@/lib/base-path"
import { cn } from "@/lib/utils"

interface ReportMeta {
  date: string
  generated_at: string | null
  status: string
}

interface ReportFull extends ReportMeta {
  data_snapshot: string
  narrative: string
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00Z")
  return d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })
}

function formatGenerated(iso: string | null) {
  if (!iso) return "Unknown"
  const d = new Date(iso)
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZoneName: "short" })
}

export default function ReportsPage() {
  const [reports, setReports] = useState<ReportMeta[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [report, setReport] = useState<ReportFull | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [triggering, setTriggering] = useState(false)
  const [showSnapshot, setShowSnapshot] = useState(false)

  const loadList = useCallback(async () => {
    setListLoading(true)
    setListError(null)
    try {
      const r = await fetch(withBase("/api/reports"), { credentials: "include" })
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        throw new Error(body?.error || `HTTP ${r.status}`)
      }
      const data: ReportMeta[] = await r.json()
      setReports(data)
      if (data.length > 0 && !selectedDate) {
        setSelectedDate(data[0].date)
      }
    } catch (e: unknown) {
      setListError(e instanceof Error ? e.message : "Failed to load reports")
    } finally {
      setListLoading(false)
    }
  }, [selectedDate])

  useEffect(() => {
    loadList()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selectedDate) return
    setReportLoading(true)
    setReport(null)
    fetch(withBase(`/api/reports?date=${encodeURIComponent(selectedDate)}`), { credentials: "include" })
      .then((r) => {
        if (!r.ok) return r.json().then((b) => Promise.reject(new Error(b?.error || `HTTP ${r.status}`)))
        return r.json()
      })
      .then((data: ReportFull) => setReport(data))
      .catch((e: Error) => {
        setReport({
          date: selectedDate,
          generated_at: null,
          status: "error",
          data_snapshot: "",
          narrative: `*Failed to load report: ${e.message}*`,
        })
      })
      .finally(() => setReportLoading(false))
  }, [selectedDate])

  const triggerReport = async () => {
    setTriggering(true)
    try {
      const r = await fetch(withBase("/api/reports?trigger"), { credentials: "include" })
      const body = await r.json().catch(() => ({}))
      if (body?.status === "already_generating") {
        alert("A report is already being generated. Check back in a few minutes.")
      } else {
        alert("Report generation started. It will appear in the list when complete (2–5 minutes).")
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
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/30 bg-card/80 px-4 backdrop-blur-md">
        <FileText className="h-4 w-4 text-muted-foreground/50" />
        <span className="text-sm font-medium">Overnight Reports</span>
        <div className="flex-1" />
        <button
          onClick={loadList}
          disabled={listLoading}
          className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent/30 rounded transition-colors"
          title="Refresh list"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", listLoading && "animate-spin")} />
        </button>
        <button
          onClick={triggerReport}
          disabled={triggering}
          className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground/50 hover:text-foreground hover:bg-accent/30 rounded transition-colors border border-border/30"
          title="Generate report now"
        >
          {triggering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
          Generate Now
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Report list sidebar */}
        <div className="w-56 shrink-0 border-r border-border/30 overflow-y-auto bg-card/20">
          {listLoading ? (
            <div className="flex items-center gap-2 px-4 py-6 text-xs text-muted-foreground/50">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading...
            </div>
          ) : listError ? (
            <div className="px-4 py-6 space-y-2">
              <div className="flex items-center gap-1.5 text-xs text-rose-400/80">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                Analytics service unavailable
              </div>
              <p className="text-[11px] text-muted-foreground/40 leading-relaxed">
                Ensure PYTHON_SERVICE_URL is set and the Python service is running.
              </p>
            </div>
          ) : reports.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <FileText className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground/40">No reports yet.</p>
              <p className="text-[11px] text-muted-foreground/30 mt-1">
                Click &ldquo;Generate Now&rdquo; to create the first one.
              </p>
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
                  {r.status === "error" && (
                    <AlertCircle className="h-3 w-3 shrink-0 text-rose-400/70" />
                  )}
                  <ChevronRight className="h-3 w-3 shrink-0 opacity-30" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Report content */}
        <div className="flex-1 min-w-0 overflow-y-auto p-6">
          {!selectedDate ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground/30 gap-3">
              <FileText className="h-12 w-12 opacity-30" />
              <p className="text-sm">Select a report from the list</p>
            </div>
          ) : reportLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground/50">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading report...
            </div>
          ) : report ? (
            <div className="max-w-3xl space-y-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h1 className="text-xl font-semibold">{formatDate(report.date)}</h1>
                  {report.generated_at && (
                    <p className="text-sm text-muted-foreground/50 mt-0.5">
                      Generated at {formatGenerated(report.generated_at)}
                    </p>
                  )}
                </div>
                {report.status === "error" && (
                  <span className="flex items-center gap-1 text-xs text-rose-400/80 border border-rose-400/20 rounded px-2 py-1">
                    <AlertCircle className="h-3 w-3" />
                    Error
                  </span>
                )}
              </div>

              {/* AI Narrative */}
              {report.narrative && (
                <div className="rounded-lg border border-border/30 bg-card/40 p-5">
                  <h2 className="text-sm font-semibold text-muted-foreground mb-3 pb-2 border-b border-border/20">
                    AI Analysis
                  </h2>
                  <div className="prose prose-sm prose-invert max-w-none text-foreground/90 leading-relaxed">
                    <ReactMarkdown>{report.narrative}</ReactMarkdown>
                  </div>
                </div>
              )}

              {/* Data snapshot toggle */}
              {report.data_snapshot && (
                <div className="rounded-lg border border-border/20 overflow-hidden">
                  <button
                    onClick={() => setShowSnapshot((v) => !v)}
                    className="flex items-center gap-2 w-full px-4 py-2.5 text-xs text-muted-foreground/60 hover:text-muted-foreground hover:bg-accent/20 transition-colors text-left"
                  >
                    <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", showSnapshot && "rotate-90")} />
                    Raw Data Snapshot
                  </button>
                  {showSnapshot && (
                    <pre className="px-4 pb-4 text-[11px] text-muted-foreground/60 whitespace-pre-wrap font-mono leading-relaxed border-t border-border/20">
                      {report.data_snapshot}
                    </pre>
                  )}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
