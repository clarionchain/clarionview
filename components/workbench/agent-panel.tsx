"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import { Loader2, MoreVertical, PanelRightClose, Send, Settings, Sparkles, Trash2 } from "lucide-react"
import type { TVChartHandle } from "@/components/workbench/tv-chart"
import { buildChartContextMarkdown } from "@/lib/chart-context"
import { withBase } from "@/lib/base-path"
import { cn } from "@/lib/utils"
import type { ActiveSeries, CrosshairValues, SeriesConfig } from "@/lib/workbench-types"
import { DEFAULT_OPENROUTER_MODEL } from "@/lib/openrouter-constants"
import { useWorkbenchSettings } from "@/lib/workbench-settings-dialog-context"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export type AgentCategory = "market" | "edu" | "trade" | "technical"

const CATEGORY_LABELS: Record<AgentCategory, string> = {
  market: "Market",
  edu: "EDU",
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

type ModelRow = { id: string; name: string }

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
  const [models, setModels] = useState<ModelRow[]>([])
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [loadingModels, setLoadingModels] = useState(true)
  const [chatReady, setChatReady] = useState(true)
  const [chatHint, setChatHint] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modelPlaceholder, setModelPlaceholder] = useState(DEFAULT_OPENROUTER_MODEL)
  const [aiProvider, setAiProvider] = useState<"openrouter" | "local">("openrouter")
  const scrollRef = useRef<HTMLDivElement>(null)
  const { openSettings } = useWorkbenchSettings()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoadingModels(true)
      setModelsError(null)
      try {
        const [mRes, sRes] = await Promise.all([
          fetch(withBase("/api/ai/models"), { credentials: "include" }),
          fetch(withBase("/api/ai/settings"), { credentials: "include" }),
        ])
        const mJson = (await mRes.json().catch(() => ({}))) as {
          models?: ModelRow[]
          error?: string
          chatReady?: boolean
          chatHint?: string
          provider?: "openrouter" | "local"
        }
        const sJson = (await sRes.json().catch(() => ({}))) as {
          model?: string | null
          defaultModelSuggestion?: string
          aiChatProvider?: "openrouter" | "local"
          localModel?: string | null
          defaultLocalModelSuggestion?: string
        }
        if (cancelled) return
        const ready = mRes.ok && mJson.chatReady !== false
        setChatReady(ready)
        setChatHint(
          ready
            ? null
            : typeof mJson.chatHint === "string"
              ? mJson.chatHint
              : !mRes.ok && typeof mJson.error === "string"
                ? mJson.error
                : null
        )
        if (mRes.ok && Array.isArray(mJson.models)) {
          setModels(mJson.models)
          setModelsError(null)
        } else {
          setModels([])
          setModelsError(typeof mJson.error === "string" ? mJson.error : "Could not load models")
        }
        const prov = sJson.aiChatProvider === "local" ? "local" : "openrouter"
        setAiProvider(prov)
        const pref =
          prov === "local"
            ? sJson.localModel?.trim() ||
              sJson.defaultLocalModelSuggestion?.trim() ||
              "llama3.2"
            : sJson.model?.trim() || sJson.defaultModelSuggestion?.trim() || DEFAULT_OPENROUTER_MODEL
        setModelPlaceholder(pref)
        setModel((prev) => (prev ? prev : pref))
      } catch {
        if (!cancelled) {
          setModelsError("Network error loading models")
          setModels([])
          setChatReady(false)
          setChatHint("Could not reach the server. Check your connection and base path.")
        }
      } finally {
        if (!cancelled) setLoadingModels(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || sending) return

    const visibleRange = chartRef.current?.getVisibleTimeRange() ?? null
    const ctx = buildChartContextMarkdown({
      workbookName,
      configs,
      activeSeries,
      crosshair,
      visibleRange,
      paneScales,
    })

    const nextThread = [...thread, { role: "user" as const, content: text }].slice(-MAX_THREAD_MESSAGES)
    setThread(nextThread)
    setInput("")
    setSending(true)
    setError(null)

    const apiMessages = [
      { role: "system" as const, content: CATEGORY_SYSTEM[category] },
      ...nextThread.map((t) => ({ role: t.role, content: t.content })),
    ]

    const modelTrim = model.trim()

    try {
      const res = await fetch(withBase("/api/ai/chat"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          chartContext: ctx,
          model: modelTrim || undefined,
          stream: true,
        }),
      })

      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setError(typeof j.error === "string" ? j.error : `Request failed (${res.status})`)
        setThread((prev) => prev.slice(0, -1))
        return
      }

      if (!res.body) {
        setError("No response body")
        setThread((prev) => prev.slice(0, -1))
        return
      }

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
          if (last?.role === "assistant") {
            copy[copy.length - 1] = { role: "assistant", content: assistant }
          }
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
          } catch {
            /* ignore partial or non-JSON lines */
          }
        }
        if (done) break
      }

      const tail = buffer.trim()
      if (tail.startsWith("data:")) {
        const data = tail.slice(5).trim()
        if (data !== "[DONE]") {
          try {
            const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }
            const c = j.choices?.[0]?.delta?.content
            if (typeof c === "string" && c.length > 0) appendDelta(c)
          } catch {
            /* ignore */
          }
        }
      }

      setThread((prev) => {
        const copy = [...prev]
        const last = copy[copy.length - 1]
        if (last?.role === "assistant" && last.content.length === 0) {
          copy[copy.length - 1] = { role: "assistant", content: "(No text returned)" }
        }
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
  }, [
    input,
    sending,
    chartRef,
    workbookName,
    configs,
    activeSeries,
    crosshair,
    paneScales,
    thread,
    category,
    model,
    scrollToBottom,
  ])

  useEffect(() => {
    scrollToBottom()
  }, [thread, scrollToBottom])

  const filteredModels = useMemo(() => {
    const q = model.trim().toLowerCase()
    if (!q) return models.slice(0, 80)
    return models.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)).slice(0, 80)
  }, [models, model])

  return (
    <div
      className="workbench-shell-surface flex h-full min-h-0 flex-col text-foreground"
      style={{ backgroundColor: "var(--workbench-shell)" }}
    >
      <header
        className="relative flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5"
        style={{ backgroundColor: "var(--workbench-shell)" }}
      >
        <Sparkles className="h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold tracking-tight text-foreground">Assistant</h2>
          <p className="truncate text-[10px] text-muted-foreground">Workbench · chart context</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              title="Assistant menu"
              aria-label="Assistant menu"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 border-border bg-popover">
            <DropdownMenuItem
              className="gap-2"
              onSelect={() => {
                openSettings("ai")
              }}
            >
              <Settings className="h-4 w-4 opacity-70" />
              Preferences — AI &amp; models
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2"
              onSelect={() => {
                openSettings("account")
              }}
            >
              <Settings className="h-4 w-4 opacity-70" />
              Preferences — Account
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          title="Close panel"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </header>

      {!chatReady && chatHint ? (
        <div className="shrink-0 border-b border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-amber-200/90">
          <span className="font-medium text-amber-100">Assistant is not ready.</span> {chatHint}{" "}
          <button
            type="button"
            onClick={() => openSettings("ai")}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Open AI preferences
          </button>
        </div>
      ) : null}

      <div
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 py-1.5"
        style={{ backgroundColor: "var(--workbench-shell)" }}
      >
        {(Object.keys(CATEGORY_LABELS) as AgentCategory[]).map((k) => (
          <button
            key={k}
            type="button"
            disabled={sending}
            onClick={() => setCategory(k)}
            className={cn(
              "shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
              category === k
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
            )}
          >
            {CATEGORY_LABELS[k]}
          </button>
        ))}
      </div>

      <div
        className="shrink-0 space-y-1.5 border-b border-border px-3 py-2"
        style={{ backgroundColor: "var(--workbench-shell)" }}
      >
        <label className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Model id</label>
        <input
          type="text"
          list="assistant-model-ids"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={modelPlaceholder}
          spellCheck={false}
          className="w-full rounded-md border border-border/50 bg-white/[0.06] px-2 py-1.5 font-mono text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-primary/50 focus:ring-1 focus:ring-ring/40"
        />
        <datalist id="assistant-model-ids">
          {filteredModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </datalist>
        {loadingModels ? (
          <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading catalog…
          </p>
        ) : modelsError ? (
          <p className="text-[10px] text-amber-400/90">
            {modelsError} — you can still type a model id manually (check your server or OpenRouter).
          </p>
        ) : (
          <p className="text-[10px] text-muted-foreground/80">
            {aiProvider === "local"
              ? `${models.length} ids from your local server (type to filter). Override here per thread; empty uses your saved default.`
              : `${models.length} ids in catalog (type to filter). Uses OpenRouter when that provider is selected in preferences.`}
          </p>
        )}
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3"
        style={{ backgroundColor: "var(--workbench-shell)" }}
      >
        {thread.length === 0 ? (
          <div className="rounded-lg border border-border/40 bg-muted/20 p-3 text-xs leading-relaxed text-muted-foreground">
            <p className="mb-1.5 font-medium text-foreground">How this works</p>
            <p className="mb-2">
              Messages include your workbook context (visible range, series, crosshair). Pick a category, set a model id,
              then ask below.
            </p>
            <p className="text-[11px] text-muted-foreground/90">
              Configure the assistant under the panel menu → Preferences, or the sidebar Preferences entry. Choose OpenRouter
              or a local OpenAI-compatible API.
            </p>
          </div>
        ) : null}

        {thread.map((turn, i) => (
          <div
            key={i}
            className={cn(
              "rounded-lg border px-3 py-2 text-sm",
              turn.role === "user"
                ? "ml-3 border-border bg-accent/25"
                : "mr-3 border-border bg-muted/15"
            )}
          >
            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {turn.role === "user" ? "You" : "Assistant"}
            </div>
            {turn.role === "user" ? (
              <p className="whitespace-pre-wrap text-foreground">{turn.content}</p>
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

        {error ? <p className="px-1 text-xs text-amber-400/90">{error}</p> : null}
      </div>

      <footer
        className="shrink-0 space-y-2 border-t border-border/40 p-3"
        style={{ backgroundColor: "var(--workbench-shell)" }}
      >
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            placeholder="Follow-up… (Enter send, Shift+Enter newline)"
            rows={variant === "mobile" ? 3 : 2}
            disabled={sending || !chatReady}
            className="min-h-[44px] flex-1 resize-none rounded-md border border-border/50 bg-white/[0.06] px-2 py-1.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-primary/50 focus:ring-1 focus:ring-ring/40"
          />
          <button
            type="button"
            disabled={sending || !input.trim() || !chatReady}
            onClick={() => void send()}
            className="shrink-0 self-end rounded-md bg-primary px-3 py-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            title="Send"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
        <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
          <button
            type="button"
            onClick={() => {
              setThread([])
              setError(null)
            }}
            className="inline-flex items-center gap-1 rounded-md transition-colors hover:bg-accent/40 hover:text-accent-foreground"
          >
            <Trash2 className="h-3 w-3" /> Clear thread
          </button>
          <button
            type="button"
            onClick={() => openSettings("ai")}
            className="transition-colors hover:text-primary"
          >
            AI preferences
          </button>
        </div>
      </footer>
    </div>
  )
}
