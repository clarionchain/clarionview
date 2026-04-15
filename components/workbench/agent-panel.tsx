"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import { Brain, Link2, Loader2, PanelRightClose, Send, Settings, Trash2 } from "lucide-react"
import type { SummarizeLength } from "@/app/api/ai/summarize/route"
import type { TVChartHandle } from "@/components/workbench/tv-chart"
import { buildChartContextMarkdown } from "@/lib/chart-context"
import { withBase } from "@/lib/base-path"
import { cn } from "@/lib/utils"
import type { ActiveSeries, CrosshairValues, SeriesConfig } from "@/lib/workbench-types"
import { DEFAULT_OPENROUTER_MODEL } from "@/lib/openrouter-constants"
import { useWorkbenchSettings } from "@/lib/workbench-settings-dialog-context"
import { computeMetrics, runMonteCarlo, fmtPct, fmtRatio, fmtNum, fmtPrice } from "@/lib/quant"
import type { MonteCarloResult } from "@/lib/quant"

export type AgentCategory = "market" | "edu" | "trade" | "technical" | "quant"

const LENGTH_LABELS: Record<SummarizeLength, string> = {
  short: "Short",
  medium: "Medium",
  long: "Long",
  xl: "XL",
}

const CATEGORY_LABELS: Record<AgentCategory, string> = {
  market: "Market",
  edu: "Education",
  trade: "Trade",
  technical: "Technical",
  quant: "Quant",
}

const FORMAT_RULES = `
RESPONSE FORMAT — follow exactly:
- Use emojis to lead each point (📈 📉 ⚠️ 🔑 💡 🎯 etc.)
- Short punchy statements only — no long sentences
- Use blank lines between sections for breathing room
- Max 5–7 bullet points total, no walls of text
- End with one bold bottom-line verdict on its own line
- No preamble, no "this chart shows", just signal
`.trim()

const CHART_ANALYSIS_INSTRUCTION = `You are given a screenshot of a financial chart. Study the image carefully. Your analysis MUST reference specific values, price levels, dates, and patterns that are VISUALLY PRESENT in this image — not generic market knowledge. If the chart shows a specific number, cite it. If there is a trend, describe its direction and approximate magnitude visible in the chart. Never give commentary that ignores what is actually drawn.`

const CATEGORY_SYSTEM: Record<AgentCategory, string> = {
  market: `${CHART_ANALYSIS_INSTRUCTION} You are a sharp market analyst — cut to the signal. ${FORMAT_RULES}`,
  edu: `${CHART_ANALYSIS_INSTRUCTION} You are a concise educator — name each visible metric, what it measures, and what its current reading in this chart shows. ${FORMAT_RULES}`,
  trade: `${CHART_ANALYSIS_INSTRUCTION} Focus on tradeable observations visible in this chart — exact levels, momentum, risk/reward. Nothing here is financial advice. ${FORMAT_RULES}`,
  technical: `${CHART_ANALYSIS_INSTRUCTION} You are a technical analyst — identify trend direction, momentum, key price levels, and chart patterns that are VISIBLE IN THIS IMAGE. Quantify everything you can see. ${FORMAT_RULES}`,
  quant: "",
}

const CATEGORY_PROMPT: Record<AgentCategory, string> = {
  market: "Analyze this chart: what are the key market signals visible here, and what do they say about current conditions?",
  edu: "Analyze this chart: for each visible metric or series, what does it measure and what is its current reading showing?",
  trade: "Analyze this chart: what are the exact key levels, trend direction, and risk considerations visible right now?",
  technical: "Analyze this chart: give a detailed technical read — trend, momentum, key price levels, and any notable patterns you can see.",
  quant: "",
}

const MAX_THREAD_MESSAGES = 36

type ThreadTurn = { role: "user" | "assistant"; content: string }

type AgentPanelProps = {
  variant: "desktop" | "mobile"
  onClose: () => void
  workbookName: string
  configs: SeriesConfig[]
  activeSeries: ActiveSeries[]
  crosshair: CrosshairValues | null
  paneScales: Record<number, "log" | "linear">
  chartRef: React.RefObject<TVChartHandle | null>
  screenshotFnRef?: React.MutableRefObject<(() => string | null) | null>
}

function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim())
}

function QuantRow({ label, value, positive, negative }: { label: string; value: string; positive?: boolean; negative?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-1">
      <span className="text-[10px] text-muted-foreground/50 shrink-0">{label}</span>
      <span className={cn(
        "text-[11px] font-mono font-medium tabular-nums",
        positive ? "text-emerald-400/90" : negative ? "text-red-400/80" : "text-foreground/70"
      )}>{value}</span>
    </div>
  )
}

function MonteCarloChart({ result, color }: { result: MonteCarloResult; color: string }) {
  const W = 380
  const H = 130
  const { paths, p10, p50, p90 } = result
  const nSteps = p50.length

  const allVals = [...p10, ...p90]
  let minV = Math.min(...allVals)
  let maxV = Math.max(...allVals)
  const range = maxV - minV || 1
  minV -= range * 0.06
  maxV += range * 0.06
  const span = maxV - minV

  const xf = (i: number) => ((i / (nSteps - 1)) * W).toFixed(1)
  const yf = (v: number) => (H - ((v - minV) / span) * H).toFixed(1)

  const toD = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? "M" : "L"}${xf(i)},${yf(v)}`).join(" ")

  const bandD = [
    ...p90.map((v, i) => `${i === 0 ? "M" : "L"}${xf(i)},${yf(v)}`),
    ...[...p10].reverse().map((v, i) => `L${xf(nSteps - 1 - i)},${yf(v)}`),
    "Z",
  ].join(" ")

  // Sample 60 paths for rendering performance
  const samplePaths = paths.filter((_, i) => i % Math.max(1, Math.floor(paths.length / 60)) === 0)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full rounded overflow-hidden"
      style={{ height: H }}
      aria-hidden="true"
    >
      {samplePaths.map((path, idx) => (
        <path
          key={idx}
          d={toD(path)}
          fill="none"
          stroke={color}
          strokeOpacity="0.07"
          strokeWidth="0.7"
        />
      ))}
      <path d={bandD} fill={color} fillOpacity="0.13" stroke="none" />
      <path d={toD(p10)} fill="none" stroke={color} strokeOpacity="0.35" strokeWidth="1" strokeDasharray="3,2" />
      <path d={toD(p90)} fill="none" stroke={color} strokeOpacity="0.35" strokeWidth="1" strokeDasharray="3,2" />
      <path d={toD(p50)} fill="none" stroke={color} strokeOpacity="0.9" strokeWidth="1.5" />
      <line x1={xf(0)} y1="0" x2={xf(0)} y2={H} stroke="rgba(255,255,255,0.12)" strokeWidth="1" strokeDasharray="3,3" />
    </svg>
  )
}

export function AgentPanel({
  variant,
  onClose,
  workbookName,
  configs,
  activeSeries,
  crosshair,
  paneScales,
  chartRef,
  screenshotFnRef,
}: AgentPanelProps) {
  const [category, setCategory] = useState<AgentCategory>("market")
  const [thread, setThread] = useState<ThreadTurn[]>([])
  const [input, setInput] = useState("")
  const [model, setModel] = useState("")
  const [analyzing, setAnalyzing] = useState(false)
  const [summarizeLength, setSummarizeLength] = useState<SummarizeLength>("medium")
  const [chatReady, setChatReady] = useState(true)
  const [chatHint, setChatHint] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { openSettings } = useWorkbenchSettings()

  const inputIsUrl = isUrl(input)

  // Load provider settings once on mount
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [mRes, sRes] = await Promise.all([
          fetch(withBase("/api/ai/models"), { credentials: "include" }),
          fetch(withBase("/api/ai/settings"), { credentials: "include" }),
        ])
        const mJson = (await mRes.json().catch(() => ({}))) as {
          chatReady?: boolean
          chatHint?: string
          error?: string
        }
        const sJson = (await sRes.json().catch(() => ({}))) as {
          model?: string | null
          defaultModelSuggestion?: string
          aiChatProvider?: "openrouter" | "local" | "routstr"
          localModel?: string | null
          defaultLocalModelSuggestion?: string
          routstrModel?: string | null
          defaultRoutstrModelSuggestion?: string
        }
        if (cancelled) return

        const ready = mRes.ok && mJson.chatReady !== false
        setChatReady(ready)
        setChatHint(
          ready ? null :
          typeof mJson.chatHint === "string" ? mJson.chatHint :
          typeof mJson.error === "string" ? mJson.error : null
        )

        const prov = sJson.aiChatProvider
        const pref =
          prov === "local"
            ? sJson.localModel?.trim() || sJson.defaultLocalModelSuggestion?.trim() || "llama3.2"
            : prov === "routstr"
              ? sJson.routstrModel?.trim() || sJson.defaultRoutstrModelSuggestion?.trim() || "meta-llama/llama-3.1-8b-instruct"
              : sJson.model?.trim() || sJson.defaultModelSuggestion?.trim() || DEFAULT_OPENROUTER_MODEL
        setModel(pref)
      } catch {
        if (!cancelled) {
          setChatReady(false)
          setChatHint("Could not reach server.")
        }
      }
    })()
    return () => { cancelled = true }
  }, [])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || sending) return

    const visibleRange = chartRef.current?.getVisibleTimeRange() ?? null
    const ctx = buildChartContextMarkdown({ workbookName, configs, activeSeries, crosshair, visibleRange, paneScales })

    const nextThread = [...thread, { role: "user" as const, content: text }].slice(-MAX_THREAD_MESSAGES)
    setThread(nextThread)
    setInput("")
    setSending(true)
    setError(null)

    const apiMessages = [
      { role: "system" as const, content: CATEGORY_SYSTEM[category] },
      ...nextThread.map((t) => ({ role: t.role, content: t.content })),
    ]

    try {
      const res = await fetch(withBase("/api/ai/chat"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages, chartContext: ctx, model: model || undefined, stream: true }),
      })

      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setError(typeof j.error === "string" ? j.error : `Request failed (${res.status})`)
        setThread((prev) => prev.slice(0, -1))
        return
      }

      if (!res.body) { setError("No response body"); setThread((prev) => prev.slice(0, -1)); return }

      // Successful response — clear any stale auth warning
      setChatReady(true)
      setChatHint(null)

      let assistant = ""
      setThread((prev) => [...prev, { role: "assistant", content: "" }])

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      const appendDelta = (d: string) => {
        assistant += d
        setThread((prev) => {
          const copy = [...prev]
          const last = copy[copy.length - 1]
          if (last?.role === "assistant") copy[copy.length - 1] = { role: "assistant", content: assistant }
          return copy
        })
      }

      while (true) {
        const { done, value } = await reader.read()
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
        for (;;) {
          const nl = buffer.indexOf("\n")
          if (nl < 0) break
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          if (!line.startsWith("data:")) continue
          const data = line.slice(5).trim()
          if (data === "[DONE]") continue
          try {
            const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }
            const c = j.choices?.[0]?.delta?.content
            if (typeof c === "string" && c.length > 0) appendDelta(c)
          } catch { /* ignore */ }
        }
        if (done) break
      }

      setThread((prev) => {
        const copy = [...prev]
        const last = copy[copy.length - 1]
        if (last?.role === "assistant" && last.content.length === 0)
          copy[copy.length - 1] = { role: "assistant", content: "(No text returned)" }
        return copy
      })
    } catch {
      setError("Network error")
      setThread((prev) => {
        const last = prev[prev.length - 1]
        if (last?.role === "user" && last.content === text) return prev.slice(0, -1)
        return prev
      })
    } finally {
      setSending(false)
      requestAnimationFrame(scrollToBottom)
    }
  }, [input, sending, chartRef, workbookName, configs, activeSeries, crosshair, paneScales, thread, category, model, scrollToBottom])

  const summarize = useCallback(async () => {
    const url = input.trim()
    if (!url || sending) return
    setSending(true)
    setError(null)

    const userMsg = `Summarize: ${url}`
    setThread((prev) => [...prev, { role: "user" as const, content: userMsg }])
    setInput("")

    try {
      const res = await fetch(withBase("/api/ai/summarize"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, length: summarizeLength, model: model || undefined }),
      })

      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setError(typeof j.error === "string" ? j.error : `Request failed (${res.status})`)
        setThread((prev) => prev.slice(0, -1))
        return
      }

      if (!res.body) { setError("No response body"); setThread((prev) => prev.slice(0, -1)); return }

      const pageTitle = res.headers.get("X-Summarize-Title")
        ? decodeURIComponent(res.headers.get("X-Summarize-Title")!)
        : null

      let assistant = pageTitle ? `**${pageTitle}**\n\n` : ""
      setThread((prev) => [...prev, { role: "assistant", content: assistant }])

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      const appendDelta = (d: string) => {
        assistant += d
        setThread((prev) => {
          const copy = [...prev]
          const last = copy[copy.length - 1]
          if (last?.role === "assistant") copy[copy.length - 1] = { role: "assistant", content: assistant }
          return copy
        })
      }

      while (true) {
        const { done, value } = await reader.read()
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
        for (;;) {
          const nl = buffer.indexOf("\n")
          if (nl < 0) break
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          if (!line.startsWith("data:")) continue
          const data = line.slice(5).trim()
          if (data === "[DONE]") continue
          try {
            const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }
            const c = j.choices?.[0]?.delta?.content
            if (typeof c === "string" && c.length > 0) appendDelta(c)
          } catch { /* ignore */ }
        }
        if (done) break
      }
    } catch {
      setError("Network error")
      setThread((prev) => {
        const last = prev[prev.length - 1]
        if (last?.role === "user" && last.content === userMsg) return prev.slice(0, -1)
        return prev
      })
    } finally {
      setSending(false)
      requestAnimationFrame(scrollToBottom)
    }
  }, [input, sending, model, summarizeLength, scrollToBottom])

  useEffect(() => { scrollToBottom() }, [thread, scrollToBottom])

  const analyzeChart = useCallback(async (cat: AgentCategory) => {
    if (analyzing || sending) return
    // screenshotFnRef is filled by TVChart from inside the component where the
    // WebGL drawing buffer is still valid — this is the only reliable path.
    const screenshot = screenshotFnRef?.current?.() ?? chartRef.current?.getScreenshotDataUrl() ?? null
    if (!screenshot) { setError("Could not capture chart screenshot"); return }

    const prompt = CATEGORY_PROMPT[cat]
    const sysPrompt = CATEGORY_SYSTEM[cat]

    setThread([{ role: "user", content: prompt }])
    setAnalyzing(true)
    setError(null)

    const imageContent = { type: "image_url", image_url: { url: screenshot } }
    const textContent = { type: "text", text: prompt }
    const apiMessages = [
      { role: "system", content: sysPrompt },
      { role: "user", content: [imageContent, textContent] },
    ]

    try {
      const res = await fetch(withBase("/api/ai/chat"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages, model: model || undefined, stream: true }),
      })

      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setError(typeof j.error === "string" ? j.error : `Request failed (${res.status})`)
        setThread([])
        return
      }

      if (!res.body) { setError("No response body"); setThread([]); return }

      // Successful response — clear any stale auth warning
      setChatReady(true)
      setChatHint(null)

      let assistant = ""
      setThread([{ role: "user", content: prompt }, { role: "assistant", content: "" }])

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
        for (;;) {
          const nl = buffer.indexOf("\n")
          if (nl < 0) break
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          if (!line.startsWith("data:")) continue
          const data = line.slice(5).trim()
          if (data === "[DONE]") continue
          try {
            const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }
            const c = j.choices?.[0]?.delta?.content
            if (typeof c === "string" && c.length > 0) {
              assistant += c
              setThread([{ role: "user", content: prompt }, { role: "assistant", content: assistant }])
            }
          } catch { /* ignore */ }
        }
        if (done) break
      }

      if (!assistant) {
        setThread([{ role: "user", content: prompt }, { role: "assistant", content: "(No response — check model supports vision)" }])
      }
    } catch {
      setError("Network error")
      setThread([])
    } finally {
      setAnalyzing(false)
      requestAnimationFrame(scrollToBottom)
    }
  }, [analyzing, sending, chartRef, screenshotFnRef, model, scrollToBottom])

  const handleSubmit = useCallback(() => {
    if (inputIsUrl) void summarize()
    else void send()
  }, [inputIsUrl, summarize, send])

  const quantData = useMemo(() => {
    if (category !== "quant") return null
    return activeSeries
      .filter(s => s.visible && s.data.length >= 10)
      .map(s => ({
        id: s.id,
        displayName: s.displayName,
        color: s.color,
        metrics: computeMetrics(s.data),
        mc: runMonteCarlo(s.data, 200, 252),
      }))
  }, [category, activeSeries])

  return (
    <div
      className="workbench-shell-surface flex h-full min-h-0 flex-col text-foreground"
      style={{ backgroundColor: "var(--workbench-shell)" }}
    >
      {/* Header */}
      <header
        className="relative flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5"
        style={{ backgroundColor: "var(--workbench-shell)" }}
      >
        <Brain className="h-4 w-4 shrink-0 text-primary" />
        <span className="text-sm font-semibold tracking-tight text-foreground">AI</span>
        {model && (
          <span className="text-[10px] font-normal text-muted-foreground/50 truncate max-w-[160px]">
            {model.split("/").pop()}
          </span>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => openSettings("ai")}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          title="AI preferences"
        >
          <Settings className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          title="Close"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </header>

      {/* Category pills */}
      <div
        className="flex shrink-0 gap-1 border-b border-border px-2 py-2"
        style={{ backgroundColor: "var(--workbench-shell)" }}
      >
        {(Object.keys(CATEGORY_LABELS) as AgentCategory[]).map((k) => (
          <button
            key={k}
            type="button"
            disabled={sending || analyzing}
            onClick={() => { setCategory(k); if (k !== "quant") void analyzeChart(k) }}
            className={cn(
              "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              category === k
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            )}
          >
            {analyzing && category === k ? <Loader2 className="inline h-3 w-3 animate-spin" /> : CATEGORY_LABELS[k]}
          </button>
        ))}
      </div>

      {/* Not-ready banner */}
      {!chatReady && chatHint ? (
        <div className="shrink-0 border-b border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-amber-200/90">
          {chatHint}{" "}
          <button type="button" onClick={() => openSettings("ai")} className="font-medium text-primary underline-offset-2 hover:underline">
            Configure AI
          </button>
        </div>
      ) : null}

      {/* Thread — hidden in Quant mode */}
      {category !== "quant" ? (
        <>
          <div
            ref={scrollRef}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
            style={{ backgroundColor: "var(--workbench-shell)" }}
          >
            {thread.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <Brain className="h-8 w-8 text-muted-foreground/20" />
                <p className="text-xs text-muted-foreground/40">
                  Ask about the chart, or paste a URL to summarize.
                </p>
              </div>
            ) : null}

            {thread.map((turn, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm",
                  turn.role === "user"
                    ? "ml-6 border-border bg-accent/25"
                    : "mr-6 border-border/40 bg-muted/10"
                )}
              >
                {turn.role === "user" ? (
                  <p className="whitespace-pre-wrap text-foreground text-xs">{turn.content}</p>
                ) : (
                  <div
                    className={cn(
                      "markdown-assistant text-[13px] leading-relaxed text-foreground/95",
                      "[&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4",
                      "[&_code]:rounded [&_code]:bg-muted/80 [&_code]:px-1 [&_code]:font-mono [&_code]:text-sm",
                      "[&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted/80 [&_pre]:p-2",
                      "[&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-sm",
                      "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2"
                    )}
                  >
                    <ReactMarkdown>{turn.content || (sending && i === thread.length - 1 ? "…" : "")}</ReactMarkdown>
                  </div>
                )}
              </div>
            ))}

            {error ? (
              <p className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400/90">{error}</p>
            ) : null}
          </div>

          {/* Footer */}
          <footer
            className="shrink-0 space-y-1.5 border-t border-border/40 p-3"
            style={{ backgroundColor: "var(--workbench-shell)" }}
          >
            {inputIsUrl ? (
              <div className="flex items-center gap-1.5">
                <Link2 className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                <span className="text-[10px] text-muted-foreground/60">Length:</span>
                {(Object.keys(LENGTH_LABELS) as SummarizeLength[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setSummarizeLength(k)}
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] transition-colors",
                      summarizeLength === k
                        ? "bg-primary/15 text-primary"
                        : "text-muted-foreground/60 hover:text-foreground"
                    )}
                  >
                    {LENGTH_LABELS[k]}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="flex gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    handleSubmit()
                  }
                }}
                placeholder={inputIsUrl ? "Summarizing…" : "Ask about the chart… or paste a URL"}
                rows={variant === "mobile" ? 3 : 2}
                disabled={sending || !chatReady}
                className="min-h-[44px] flex-1 resize-none rounded-md border border-border/50 bg-white/[0.06] px-2 py-1.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-primary/50 focus:ring-1 focus:ring-ring/40"
              />
              <button
                type="button"
                disabled={sending || !input.trim() || !chatReady}
                onClick={handleSubmit}
                className={cn(
                  "shrink-0 self-end rounded-md px-3 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-colors",
                  inputIsUrl ? "bg-indigo-600" : "bg-primary"
                )}
                title={inputIsUrl ? "Summarize URL" : "Send"}
              >
                {sending
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : inputIsUrl
                    ? <Link2 className="h-4 w-4" />
                    : <Send className="h-4 w-4" />
                }
              </button>
            </div>

            <button
              type="button"
              onClick={() => { setThread([]); setError(null) }}
              className="flex items-center gap-1 text-[10px] text-muted-foreground/50 transition-colors hover:text-muted-foreground"
            >
              <Trash2 className="h-3 w-3" /> Clear
            </button>
          </footer>
        </>
      ) : (
        /* Quant view */
        <div
          className="min-h-0 flex-1 overflow-y-auto px-3 py-3 space-y-4"
          style={{ backgroundColor: "var(--workbench-shell)" }}
        >
          {!quantData || quantData.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <p className="text-xs text-muted-foreground/40">No visible series with enough data.</p>
            </div>
          ) : (
            quantData.map(({ id, displayName, color, metrics, mc }) => (
              <div key={id} className="rounded-lg border border-border/30 bg-muted/5 px-3 py-2.5 space-y-2">
                {/* Series title */}
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <span className="text-xs font-semibold text-foreground truncate">{displayName}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground/40">{metrics.nPeriods.toLocaleString()} pts</span>
                </div>

                {/* Metrics grid */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <QuantRow label="CAGR" value={fmtPct(metrics.cagr)} positive={metrics.cagr !== null && metrics.cagr > 0} />
                  <QuantRow label="Total Return" value={fmtPct(metrics.totalReturn)} positive={metrics.totalReturn !== null && metrics.totalReturn > 0} />
                  <QuantRow label="Ann. Vol" value={fmtPct(metrics.annualizedVol)} />
                  <QuantRow label="Max Drawdown" value={metrics.maxDrawdown !== null ? "-" + fmtPct(metrics.maxDrawdown).replace(/^[+-]/, "") : "—"} negative />
                  <QuantRow label="Sharpe" value={fmtRatio(metrics.sharpe)} positive={metrics.sharpe !== null && metrics.sharpe > 0} />
                  <QuantRow label="Sortino" value={fmtRatio(metrics.sortino)} positive={metrics.sortino !== null && metrics.sortino > 0} />
                  <QuantRow label="Calmar" value={fmtRatio(metrics.calmar)} positive={metrics.calmar !== null && metrics.calmar > 0} />
                  <QuantRow label="VaR 95%" value={metrics.var95 !== null ? fmtPct(metrics.var95) : "—"} negative={metrics.var95 !== null && metrics.var95 < 0} />
                  <QuantRow label="Skewness" value={fmtNum(metrics.skewness)} />
                  <QuantRow label="Ex. Kurtosis" value={fmtNum(metrics.kurtosis)} />
                </div>

                {/* Monte Carlo */}
                {mc && (
                  <div className="space-y-1 pt-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground/50 font-medium uppercase tracking-wide">Monte Carlo · {mc.nDays}d · 200 paths</span>
                    </div>
                    <MonteCarloChart result={mc} color={color} />
                    <div className="flex justify-between text-[10px] text-muted-foreground/50 font-mono">
                      <span>P10 {fmtPrice(mc.p10[mc.p10.length - 1]!)}</span>
                      <span className="text-foreground/60">P50 {fmtPrice(mc.p50[mc.p50.length - 1]!)}</span>
                      <span>P90 {fmtPrice(mc.p90[mc.p90.length - 1]!)}</span>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
