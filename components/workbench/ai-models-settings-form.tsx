"use client"

import { useCallback, useEffect, useState } from "react"
import { Cloud, Zap, Server } from "lucide-react"
import { withBase } from "@/lib/base-path"
import { cn } from "@/lib/utils"

type AiChatProvider = "openrouter" | "local" | "routstr"

type AiSettingsResponse = {
  model: string | null
  aiChatProvider: AiChatProvider
  localOpenAiBaseUrl: string | null
  localModel: string | null
  hasLocalApiKey: boolean
  defaultLocalModelSuggestion: string
  hasRoutstrKey: boolean
  routstrModel: string | null
  defaultRoutstrModelSuggestion: string
  hasByok: boolean
  platformConfigured: boolean
  defaultModelSuggestion: string
  aiKeySource: "auto" | "byok_only" | "platform_only"
  aiAllowPlatform: boolean
  routstrPlatformConfigured: boolean
}

const PROVIDERS: { id: AiChatProvider; label: string; Icon: React.ElementType }[] = [
  { id: "openrouter", label: "OpenRouter", Icon: Cloud },
  { id: "routstr",   label: "Routstr",    Icon: Zap    },
  { id: "local",     label: "Local",      Icon: Server },
]

export function AiModelsSettingsForm() {
  const [loading, setLoading]               = useState(true)
  const [provider, setProvider]             = useState<AiChatProvider>("openrouter")
  const [model, setModel]                   = useState("")
  const [localUrl, setLocalUrl]             = useState("")
  const [newKey, setNewKey]                 = useState("")
  const [hasKey, setHasKey]                 = useState(false)
  const [msg, setMsg]                       = useState("")
  const [ok, setOk]                         = useState(false)
  const [submitting, setSubmitting]         = useState(false)
  const [defaultModel, setDefaultModel]     = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setMsg("")
    try {
      const res = await fetch(withBase("/api/ai/settings"), { credentials: "include" })
      const j = (await res.json().catch(() => ({}))) as AiSettingsResponse & { error?: string }
      if (!res.ok) { setMsg(j.error ?? "Failed to load settings"); return }

      const p: AiChatProvider =
        j.aiChatProvider === "local" ? "local" :
        j.aiChatProvider === "routstr" ? "routstr" : "openrouter"
      setProvider(p)

      if (p === "local") {
        setLocalUrl(j.localOpenAiBaseUrl ?? "")
        setModel(j.localModel ?? "")
        setHasKey(j.hasLocalApiKey)
        setDefaultModel(j.defaultLocalModelSuggestion || "llama3.2")
      } else if (p === "routstr") {
        setModel(j.routstrModel ?? "")
        setHasKey(j.hasRoutstrKey)
        setDefaultModel(j.defaultRoutstrModelSuggestion || "meta-llama/llama-3.1-8b-instruct")
      } else {
        setModel(j.model ?? "")
        setHasKey(j.hasByok)
        setDefaultModel(j.defaultModelSuggestion || "openai/gpt-4o-mini")
      }
    } catch {
      setMsg("Network error")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // When switching providers, reload defaults
  function switchProvider(p: AiChatProvider) {
    setProvider(p)
    setModel("")
    setNewKey("")
    setHasKey(false)
    setMsg("")
    setOk(false)
    load()
  }

  async function save() {
    setMsg(""); setOk(false); setSubmitting(true)
    try {
      const keyAction = newKey.trim() ? "set" : "keep"
      const body: Record<string, unknown> = {
        aiChatProvider: provider,
        openrouterKeyAction: provider === "openrouter" ? keyAction : "keep",
        localApiKeyAction:   provider === "local"      ? keyAction : "keep",
        routstrKeyAction:    provider === "routstr"    ? keyAction : "keep",
        model:               provider === "openrouter" ? (model.trim() || null) : null,
        localModel:          provider === "local"      ? (model.trim() || null) : null,
        localOpenAiBaseUrl:  provider === "local"      ? (localUrl.trim() || null) : null,
        routstrModel:        provider === "routstr"    ? (model.trim() || null) : null,
        aiKeySource: "auto",
        aiAllowPlatform: true,
      }
      if (newKey.trim()) {
        if (provider === "openrouter") body.openrouterApiKey = newKey
        if (provider === "local")      body.localApiKey      = newKey
        if (provider === "routstr")    body.routstrApiKey    = newKey
      }
      const res = await fetch(withBase("/api/ai/settings"), {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const j = (await res.json().catch(() => ({}))) as AiSettingsResponse & { error?: string }
      if (!res.ok) { setMsg(j.error ?? "Save failed"); return }
      setOk(true)
      setNewKey("")
      setHasKey(
        provider === "local" ? j.hasLocalApiKey :
        provider === "routstr" ? j.hasRoutstrKey : j.hasByok
      )
    } catch {
      setMsg("Network error")
    } finally {
      setSubmitting(false)
    }
  }

  async function removeKey() {
    setMsg(""); setOk(false); setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        aiChatProvider: provider,
        openrouterKeyAction: provider === "openrouter" ? "clear" : "keep",
        localApiKeyAction:   provider === "local"      ? "clear" : "keep",
        routstrKeyAction:    provider === "routstr"    ? "clear" : "keep",
        aiKeySource: "auto", aiAllowPlatform: true,
      }
      const res = await fetch(withBase("/api/ai/settings"), {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) { setMsg("Failed to remove key"); return }
      setOk(true); setHasKey(false)
    } catch {
      setMsg("Network error")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="rounded-lg border border-border/40 bg-card/40 p-4">
      <h2 className="mb-4 text-sm font-medium text-muted-foreground">AI &amp; models</h2>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-5">
          {msg && <p className="text-sm text-amber-400/90">{msg}</p>}
          {ok  && <p className="text-sm text-emerald-400/90">Saved.</p>}

          {/* Provider picker */}
          <div className="flex gap-2">
            {PROVIDERS.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => switchProvider(id)}
                className={cn(
                  "flex flex-1 flex-col items-center gap-1.5 rounded-lg border py-3 px-2 text-xs font-medium transition-colors",
                  provider === id
                    ? "border-primary/60 bg-primary/10 text-foreground"
                    : "border-border/40 bg-background/40 text-muted-foreground hover:border-border hover:text-foreground"
                )}
              >
                <Icon className="h-5 w-5" />
                {label}
              </button>
            ))}
          </div>

          {/* Local URL (local only) */}
          {provider === "local" && (
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">API base URL</label>
              <input
                type="url"
                value={localUrl}
                onChange={(e) => setLocalUrl(e.target.value)}
                placeholder="http://host.docker.internal:11434/v1"
                autoComplete="off"
                className="w-full rounded-md border border-border/50 bg-background/80 px-3 py-2 font-mono text-sm outline-none focus:border-cyan-500/40"
              />
            </div>
          )}

          {/* Model */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Model</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={defaultModel}
              autoComplete="off"
              className="w-full rounded-md border border-border/50 bg-background/80 px-3 py-2 font-mono text-sm outline-none focus:border-cyan-500/40"
            />
          </div>

          {/* API key */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              API key{provider === "local" ? " (optional)" : ""}
            </label>
            <input
              type="password"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder={hasKey ? "•••••••• saved — paste to replace" : provider === "openrouter" ? "sk-or-…" : provider === "routstr" ? "sk-…" : "Leave blank if no auth"}
              autoComplete="off"
              className="w-full rounded-md border border-border/50 bg-background/80 px-3 py-2 font-mono text-sm outline-none focus:border-cyan-500/40"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={save}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Save"}
            </button>
            {hasKey && (
              <button
                type="button"
                disabled={submitting}
                onClick={removeKey}
                className="rounded-md border border-border/50 bg-background/60 px-4 py-2 text-sm text-muted-foreground hover:bg-background/90 disabled:opacity-50"
              >
                Remove key
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
