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

export type AgentCategory = "market" | "edu" | "trade" | "technical"

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
}

const CATEGORY_SYSTEM: Record<AgentCategory, string> = {
  market:
    "You are a market-focused analyst. Use the structured chart context provided separately. Be concise; state uncertainty when data is missing or ambiguous.",
  edu: "You are an educator. Explain concepts clearly; tie explanations to the chart metrics when the user asks about the workbench.",
  trade:
    "You discuss markets and risk. Nothing here is financial advice. Use only the supplied chart context for factual claims about the data.",
  technical:
    "You focus on quantitative reading: trends, ranges, pane scales, and relationships between series in the provided context.",
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
}

function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim())
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
}: AgentPanelProps) {
  const [category, setCategory] = useState<AgentCategory>("market")
  const [thread, setThread] = useState<ThreadTurn[]>([])
  const [input, setInput] = useState("")
  const [model, setModel] = useState("")
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

  const handleSubmit = useCallback(() => {
    if (inputIsUrl) void summarize()
    else void send()
  }, [inputIsUrl, summarize, send])

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
            disabled={sending}
            onClick={() => setCategory(k)}
            className={cn(
              "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              category === k
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            )}
          >
            {CATEGORY_LABELS[k]}
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

      {/* Thread */}
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
        {/* Length selector — only visible when URL pasted */}
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
    </div>
  )
}
