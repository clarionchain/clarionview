"use client"

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react"
import dynamic from "next/dynamic"
import { Save, Loader2, TrendingUp, Plus, Check, Pencil, Brain } from "lucide-react"
import { AgentPanel } from "@/components/workbench/agent-panel"
import { OnboardingModal } from "@/components/workbench/onboarding-modal"
import type { TVChartHandle } from "@/components/workbench/tv-chart"
import { MetricModal } from "./metric-modal"
import { FormulaModal } from "./formula-modal"
import { SeriesLegend } from "./series-legend"
import { computeFormula } from "@/lib/formula-engine"
import { useWorkbenchStore } from "@/lib/workbench-store"
import type { SeriesConfig, ActiveSeries, SeriesDataPoint, CrosshairValues, SavedWorkbook } from "@/lib/workbench-types"
import {
  pickColor,
  uid,
  formatValue,
  formatDate,
  normalizePaneIndex,
  normalizeSeriesConfigs,
  normalizeSeriesConfig,
} from "@/lib/workbench-types"
import { withBase } from "@/lib/base-path"
import { cn } from "@/lib/utils"
import { seriesPreviewCssColor } from "@/lib/series-visual"

const TVChart = dynamic(() => import("./tv-chart"), { ssr: false }) as React.ComponentType<
  React.ComponentProps<typeof import("./tv-chart").default> & { ref?: React.Ref<TVChartHandle> }
>

const STORAGE_KEY = "dc_workbench_state"

const SERIES_AUTH_RETRIES = 4
const SERIES_RETRY_DELAYS_MS = [0, 150, 400, 900] as const

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function stringFromSeriesErrorBody(body: { error?: unknown; code?: string }): string {
  const e = body.error
  if (typeof e === "string") return e
  if (typeof e === "object" && e !== null) {
    if ("message" in e) {
      const m = (e as { message?: unknown }).message
      if (typeof m === "string") return m
      if (typeof m === "number" || typeof m === "boolean") return String(m)
    }
    try {
      return JSON.stringify(e)
    } catch {
      /* fall through */
    }
  }
  return "Request failed"
}

function safeLoadErrorLine(message: string): string {
  if (message === "[object Object]" || message.includes("[object Object]")) {
    return "Request failed (reload the page; if this persists, redeploy Workbench or pick another metric)"
  }
  return message
}

/** Log scale cannot plot ≤0; strip those points so the series still renders. */
function sanitizeForScale(
  data: SeriesDataPoint[],
  paneIndex: number | undefined,
  paneScales: Record<number, "log" | "linear">
): SeriesDataPoint[] {
  const pane = normalizePaneIndex(paneIndex ?? 0)
  const mode = paneScales[pane] ?? "linear"
  if (mode !== "log") return data
  return data.filter((d) => d.value > 0 && Number.isFinite(d.value))
}

export function WorkbenchContainer() {
  const store = useWorkbenchStore()

  const [configs, setConfigs] = useState<SeriesConfig[]>([])
  const [dataMap, setDataMap] = useState<Map<string, SeriesDataPoint[]>>(new Map())
  const [paneScales, setPaneScales] = useState<Record<number, "log" | "linear">>({ 0: "linear" })
  const [metricModalOpen, setMetricModalOpen] = useState(false)
  const [formulaModalOpen, setFormulaModalOpen] = useState(false)
  const [editingFormula, setEditingFormula] = useState<SeriesConfig | null>(null)
  const [loading, setLoading] = useState<Set<string>>(new Set())
  const [crosshair, setCrosshair] = useState<CrosshairValues | null>(null)
  const [initialized, setInitialized] = useState(false)
  const [workbookName, setWorkbookName] = useState("Untitled")
  const [editingName, setEditingName] = useState(false)
  const [saveFlash, setSaveFlash] = useState(false)
  const [loadErrors, setLoadErrors] = useState<
    Record<string, { message: string; status: number; code?: string }>
  >({})
  const fetchingRef = useRef<Set<string>>(new Set())
  const chartRef = useRef<TVChartHandle | null>(null)
  const [assistantOpen, setAssistantOpen] = useState(true)
  const [assistantPrefsLoaded, setAssistantPrefsLoaded] = useState(false)
  /** Wait for /api/account/me so we never fire series fetches against a dead session (avoids bogus banners + stale cached shell). */
  const [authGate, setAuthGate] = useState<"pending" | "ok">("pending")
  const [showOnboarding, setShowOnboarding] = useState(false)

  const activeSeries: ActiveSeries[] = useMemo(() => {
    return configs.map((c) => {
      let data: SeriesDataPoint[]
      if (c.isFormula && c.formula && c.variables) {
        data = computeFormula(c.formula, c.variables, dataMap)
      } else {
        data = dataMap.get(c.seriesName) ?? []
      }
      data = sanitizeForScale(data, c.paneIndex, paneScales)
      return { ...c, data }
    })
  }, [configs, dataMap, paneScales])

  const activeNames = useMemo(() => new Set(configs.map((c) => c.seriesName)), [configs])

  // -- Keep store's activeWorkbookName in sync --
  useEffect(() => {
    store.setActiveWorkbookName(workbookName)
  }, [workbookName, store])

  // -- Register handlers for sidebar load/new --
  useEffect(() => {
    store.registerLoadHandler((wb: SavedWorkbook) => {
      setWorkbookName(wb.name)
      setPaneScales(wb.paneScales ?? { 0: wb.logScale ? "log" : "linear" })
      setConfigs(normalizeSeriesConfigs(wb.configs))
    })
    store.registerNewChartHandler(() => {
      setWorkbookName("Untitled")
      setPaneScales({ 0: "linear" })
      setConfigs([
        {
          id: uid(),
          seriesName: "price",
          displayName: "Price (USD)",
          color: "#F7931A",
          colorOpacity: 1,
          lineStyle: "solid",
          priceScaleId: "right",
          type: "line",
          visible: true,
        },
      ])
    })
  }, [store])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setMetricModalOpen((v) => !v)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  useEffect(() => {
    if (initialized) return
    setInitialized(true)

    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const state = JSON.parse(saved)
        setPaneScales(state.paneScales ?? { 0: state.logScale ? "log" : "linear" })
        setWorkbookName(state.name ?? "Untitled")
        if (Array.isArray(state.configs) && state.configs.length > 0) {
          setConfigs(normalizeSeriesConfigs(state.configs))
          return
        }
      }
    } catch { /* ignore */ }

    setConfigs([
      {
        id: uid(),
        seriesName: "price",
        displayName: "Price (USD)",
        color: "#F7931A",
        colorOpacity: 1,
        lineStyle: "solid",
        priceScaleId: "right",
        type: "line",
        visible: true,
      },
    ])
  }, [initialized])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(withBase("/api/account/me"), { credentials: "include" })
        if (cancelled) return
        if (r.status === 401) {
          window.location.assign(withBase("/login"))
          return
        }
        setAuthGate("ok")
      } catch {
        if (!cancelled) setAuthGate("ok")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Show onboarding if user has never completed it
  useEffect(() => {
    try {
      if (!localStorage.getItem("cv_onboarded")) {
        setShowOnboarding(true)
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    try {
      if (localStorage.getItem("dc_workbench_assistant_open") === "0") {
        setAssistantOpen(false)
      }
    } catch {
      /* ignore */
    }
    setAssistantPrefsLoaded(true)
  }, [])

  useEffect(() => {
    if (!assistantPrefsLoaded) return
    try {
      localStorage.setItem("dc_workbench_assistant_open", assistantOpen ? "1" : "0")
    } catch {
      /* ignore */
    }
  }, [assistantOpen, assistantPrefsLoaded])

  useEffect(() => {
    if (authGate !== "ok") return

    const names = new Set<string>()
    for (const c of configs) {
      if (c.isFormula && c.variables) {
        for (const seriesName of Object.values(c.variables)) {
          if (seriesName) names.add(seriesName)
        }
      } else {
        names.add(c.seriesName)
      }
    }

    for (const name of names) {
      if (dataMap.has(name) || fetchingRef.current.has(name)) continue

      fetchingRef.current.add(name)
      setLoading((prev) => new Set(prev).add(name))
      setLoadErrors((prev) => {
        if (!(name in prev)) return prev
        const next = { ...prev }
        delete next[name]
        return next
      })

      const url = withBase(`/api/workbench/series?name=${encodeURIComponent(name)}`)

      ;(async () => {
        try {
          for (let attempt = 0; attempt < SERIES_AUTH_RETRIES; attempt++) {
            const wait = SERIES_RETRY_DELAYS_MS[attempt] ?? 0
            if (wait > 0) await delay(wait)

            const r = await fetch(url, { credentials: "include" })
            const status = r.status

            if (r.ok) {
              const { data } = (await r.json()) as { data: SeriesDataPoint[] }
              setDataMap((prev) => new Map(prev).set(name, data))
              setLoadErrors((prev) => {
                const next = { ...prev }
                delete next[name]
                return next
              })
              return
            }

            const msg = (await r.json().catch(() => ({}))) as { error?: unknown; code?: string }
            const retryable401 = status === 401 && attempt < SERIES_AUTH_RETRIES - 1
            if (retryable401) continue

            const err = new Error(stringFromSeriesErrorBody(msg) || `HTTP ${status}`) as Error & {
              status: number
              code?: string
            }
            err.status = status
            err.code = typeof msg.code === "string" ? msg.code : undefined
            throw err
          }
        } catch (e: unknown) {
          const status =
            typeof e === "object" && e !== null && "status" in e && typeof (e as { status: unknown }).status === "number"
              ? (e as { status: number }).status
              : 0
          let message = e instanceof Error ? e.message : "Failed to load series"
          message = safeLoadErrorLine(message)
          const code =
            typeof e === "object" &&
            e !== null &&
            "code" in e &&
            typeof (e as { code: unknown }).code === "string"
              ? (e as { code: string }).code
              : undefined
          console.error("Fetch failed:", name, e)
          setLoadErrors((prev) => ({ ...prev, [name]: { message, status, code } }))
        } finally {
          fetchingRef.current.delete(name)
          setLoading((prev) => {
            const next = new Set(prev)
            next.delete(name)
            return next
          })
        }
      })()
    }
  }, [configs, dataMap, authGate])

  useEffect(() => {
    if (!initialized) return
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ configs, paneScales, name: workbookName })
        )
      } catch { /* ignore */ }
    }, 500)
    return () => clearTimeout(timer)
  }, [configs, paneScales, workbookName, initialized])

  const addSeries = useCallback((seriesName: string, displayName: string) => {
    setConfigs((prev) => {
      if (prev.some((c) => c.seriesName === seriesName && !c.isFormula)) return prev
      const usedColors = prev.map((c) => c.color)
      return [
        ...prev,
        {
          id: uid(),
          seriesName,
          displayName,
          color: pickColor(usedColors),
          colorOpacity: 1,
          lineStyle: "solid" as const,
          priceScaleId: prev.length === 0 ? ("right" as const) : ("left" as const),
          type: "line" as const,
          visible: true,
        },
      ]
    })
  }, [])

  const addFormula = useCallback((formula: string, variables: Record<string, string>, label: string) => {
    setConfigs((prev) => {
      const usedColors = prev.map((c) => c.color)
      const id = uid()
      return [
        ...prev,
        {
          id,
          seriesName: `formula_${id}`,
          displayName: label,
          color: pickColor(usedColors),
          colorOpacity: 1,
          lineStyle: "solid" as const,
          priceScaleId: "left" as const,
          type: "line" as const,
          visible: true,
          isFormula: true,
          formula,
          variables,
        },
      ]
    })
  }, [])

  const removeSeries = useCallback((id: string) => {
    setConfigs((prev) => prev.filter((c) => c.id !== id))
  }, [])

  const updateSeries = useCallback((id: string, patch: Partial<SeriesConfig>) => {
    setConfigs((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c
        const merged = { ...c, ...patch }
        if (patch.paneIndex !== undefined) {
          merged.paneIndex = normalizePaneIndex(patch.paneIndex)
        }
        return normalizeSeriesConfig(merged)
      })
    )
  }, [])

  const handleCrosshairMove = useCallback((data: CrosshairValues | null) => {
    setCrosshair(data)
  }, [])

  const saveWorkbook = useCallback(async () => {
    const wb: SavedWorkbook = {
      id: uid(),
      name: workbookName,
      configs,
      logScale: paneScales[0] !== "linear",
      paneScales,
      savedAt: new Date().toISOString(),
    }
    await store.saveWorkbook(wb)
    setSaveFlash(true)
    setTimeout(() => setSaveFlash(false), 1500)
  }, [workbookName, configs, paneScales, store])

  const togglePaneScale = useCallback((paneIndex: number) => {
    setPaneScales((prev) => ({
      ...prev,
      [paneIndex]: prev[paneIndex] === "linear" ? "log" : "linear",
    }))
  }, [])

  const openMetricModal = useCallback(() => setMetricModalOpen(true), [])
  const openFormulaModal = useCallback(() => {
    setEditingFormula(null)
    setFormulaModalOpen(true)
  }, [])

  const editFormulaConfig = useCallback((config: SeriesConfig) => {
    setEditingFormula(config)
    setFormulaModalOpen(true)
  }, [])

  const handleEditFormula = useCallback((id: string, formula: string, variables: Record<string, string>, label: string) => {
    setConfigs((prev) => prev.map((c) =>
      c.id === id ? { ...c, formula, variables, displayName: label } : c
    ))
  }, [])

  const existingMetricNames = useMemo(
    () => configs.filter((c) => !c.isFormula).map((c) => c.seriesName),
    [configs]
  )

  const isAnyLoading = loading.size > 0
  const isEmpty = configs.length === 0

  return (
    <div className="-m-4 lg:-m-6 h-[calc(100vh-3rem)] lg:h-[calc(100vh-4rem)] flex flex-col overflow-hidden">
      {showOnboarding && (
        <OnboardingModal
          onComplete={() => {
            try { localStorage.setItem("cv_onboarded", "1") } catch { /* ignore */ }
            setShowOnboarding(false)
          }}
          onDismiss={() => {
            try { localStorage.setItem("cv_onboarded", "1") } catch { /* ignore */ }
            setShowOnboarding(false)
          }}
        />
      )}
      {/* -- Toolbar (sticky inside scrollable main so Assistant/Save stay reachable) -- */}
      <div className="sticky top-0 z-30 flex h-10 shrink-0 items-center gap-2 border-b border-border/30 bg-card/80 px-3 backdrop-blur-md">
        {/* Editable workbook name */}
        {editingName ? (
          <input
            autoFocus
            type="text"
            value={workbookName}
            onChange={(e) => setWorkbookName(e.target.value)}
            onBlur={() => setEditingName(false)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setEditingName(false) }}
            className="bg-background/60 border border-border/50 rounded px-2 py-0.5 text-sm font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-ring/50 max-w-[220px]"
            spellCheck={false}
          />
        ) : (
          <button
            onClick={() => setEditingName(true)}
            className="flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-muted-foreground transition-colors group max-w-[220px]"
            title="Click to rename"
          >
            <span className="truncate border-b border-dashed border-transparent group-hover:border-muted-foreground/30 transition-colors">
              {workbookName}
            </span>
            <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-40 transition-opacity shrink-0" />
          </button>
        )}

        {isAnyLoading && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/40" />
        )}

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => setAssistantOpen((o) => !o)}
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-all",
            assistantOpen
              ? "bg-accent/50 text-accent-foreground"
              : "text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent/30"
          )}
          title={assistantOpen ? "Hide assistant panel" : "Show assistant panel"}
        >
          <Brain className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">AI</span>
        </button>

        {/* Save with feedback */}
        <button
          onClick={saveWorkbook}
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-all",
            saveFlash
              ? "bg-green-500/15 text-green-400"
              : "text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent/30"
          )}
          title={`Save "${workbookName}"`}
        >
          {saveFlash ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">{saveFlash ? "Saved" : "Save"}</span>
        </button>

      </div>

      {/* -- Chart + assistant -- */}
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden lg:flex-row">
        <div className="workbench-shell-surface flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {(() => {
          const namesNeeded = new Set<string>()
          for (const c of configs) {
            if (c.isFormula && c.variables) {
              for (const seriesName of Object.values(c.variables)) {
                if (seriesName) namesNeeded.add(seriesName)
              }
            } else {
              namesNeeded.add(c.seriesName)
            }
          }
          const entries = Object.entries(loadErrors).filter(([n]) => namesNeeded.has(n))
          if (entries.length === 0) return null

          const allSession =
            entries.length > 0 &&
            entries.every(
              ([, e]) =>
                e.status === 401 &&
                (e.code === "WORKBENCH_SESSION" ||
                  (e.code === undefined && e.message === "Unauthorized"))
            )
          return (
            <div className="shrink-0 border-b border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200/90">
              {allSession ? (
                <>
                  <span className="font-medium">Could not verify your login for data requests.</span>
                  <span className="mt-1 block text-amber-200/75">
                    Try refreshing the page. If this persists, sign out and sign in again.
                  </span>
                </>
              ) : (
                <span className="font-medium">Could not load some series.</span>
              )}
              {entries.map(([n, err]) => (
                <span key={n} className="block text-amber-200/70">
                  {n}: {safeLoadErrorLine(err.message)}
                  {err.status ? ` (HTTP ${err.status})` : ""}
                </span>
              ))}
            </div>
          )
        })()}
        <div className="flex-1 relative min-h-0">
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground/30 gap-4">
              <TrendingUp className="h-16 w-16 opacity-30" />
              <div className="text-center">
                <p className="text-sm font-medium text-muted-foreground/50">No metrics selected</p>
                <p className="text-xs mt-1 text-muted-foreground/30">
                  Click Add Metric or press ⌘K to get started
                </p>
              </div>
              <button
                onClick={openMetricModal}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-primary/70 hover:text-primary bg-primary/5 hover:bg-primary/10 rounded-md border border-primary/15 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Metric
              </button>
            </div>
          ) : (
            <TVChart
              ref={chartRef}
              series={activeSeries}
              paneScales={paneScales}
              onTogglePaneScale={togglePaneScale}
              onCrosshairMove={handleCrosshairMove}
            />
          )}

          {/* Crosshair tooltip */}
          {crosshair && configs.length > 0 && (
            <div className="absolute top-3 left-3 bg-card/80 backdrop-blur-md border border-border/20 rounded-lg px-3 py-2 pointer-events-none z-10 max-w-[260px]">
              <div className="text-[11px] text-muted-foreground font-medium mb-1.5 pb-1 border-b border-border/15">
                {formatDate(crosshair.time)}
              </div>
              <div className="space-y-0.5">
                {configs
                  .filter((c) => c.visible)
                  .map((c) => (
                    <div key={c.id} className="flex items-center gap-2 text-[11px] py-0.5">
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: seriesPreviewCssColor(c.color, c.colorOpacity ?? 1) }}
                      />
                      <span className="text-muted-foreground/70 truncate flex-1 min-w-0">
                        {c.displayName}
                      </span>
                      <span className="text-foreground font-mono shrink-0">
                        {crosshair.entries[c.id] != null
                          ? formatValue(crosshair.entries[c.id]!)
                          : "—"}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Series legend */}
        {configs.length > 0 && (
          <SeriesLegend
            configs={configs}
            loading={loading}
            onUpdate={updateSeries}
            onRemove={removeSeries}
            onOpenMetricModal={openMetricModal}
            onOpenFormulaModal={openFormulaModal}
            onEditFormula={editFormulaConfig}
          />
        )}
        </div>

        {assistantOpen ? (
          <>
            <div
              className="workbench-shell-surface hidden min-h-0 w-[min(420px,42vw)] shrink-0 flex-col overflow-hidden border-l border-border lg:flex"
              style={{ backgroundColor: "var(--workbench-shell)" }}
            >
              <AgentPanel
                variant="desktop"
                onClose={() => setAssistantOpen(false)}
                workbookName={workbookName}
                configs={configs}
                activeSeries={activeSeries}
                crosshair={crosshair}
                paneScales={paneScales}
                chartRef={chartRef}
              />
            </div>
            <div
              className="fixed inset-0 z-[100] flex flex-col backdrop-blur-sm lg:hidden"
              style={{
                backgroundColor: "color-mix(in srgb, var(--workbench-shell) 72%, transparent)",
              }}
              onClick={() => setAssistantOpen(false)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setAssistantOpen(false)
              }}
              role="presentation"
            >
              <div
                className="workbench-shell-surface mt-auto flex h-[min(88dvh,640px)] min-h-0 flex-col overflow-hidden rounded-t-xl border border-border border-b-0"
                style={{ backgroundColor: "var(--workbench-shell)" }}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label="Assistant"
              >
                <AgentPanel
                  variant="mobile"
                  onClose={() => setAssistantOpen(false)}
                  workbookName={workbookName}
                  configs={configs}
                  activeSeries={activeSeries}
                  crosshair={crosshair}
                  paneScales={paneScales}
                  chartRef={chartRef}
                />
              </div>
            </div>
          </>
        ) : null}
      </div>

      {/* Floating open control — matches “dock from corner” expectation; same state as toolbar Assistant */}
      {!assistantOpen ? (
        <button
          type="button"
          className="fixed bottom-5 right-5 z-[95] flex h-12 w-12 items-center justify-center rounded-full border border-border bg-primary text-primary-foreground shadow-md transition-transform hover:scale-[1.04] active:scale-95"
          title="Open assistant"
          aria-label="Open AI assistant panel"
          onClick={() => setAssistantOpen(true)}
        >
          <Brain className="h-5 w-5" strokeWidth={1.75} />
        </button>
      ) : null}

      {/* -- Modals -- */}
      <MetricModal
        open={metricModalOpen}
        activeNames={activeNames}
        loading={loading}
        onAdd={addSeries}
        onClose={() => setMetricModalOpen(false)}
      />
      <FormulaModal
        open={formulaModalOpen}
        existingMetrics={existingMetricNames}
        editingConfig={editingFormula}
        onAdd={addFormula}
        onEdit={handleEditFormula}
        onClose={() => { setFormulaModalOpen(false); setEditingFormula(null) }}
      />
    </div>
  )
}
