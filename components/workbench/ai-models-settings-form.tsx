"use client"

import { useCallback, useEffect, useState } from "react"
import { withBase } from "@/lib/base-path"

type AiChatProvider = "openrouter" | "local" | "routstr"

type AiSettingsResponse = {
  model: string | null
  aiKeySource: "auto" | "byok_only" | "platform_only"
  aiAllowPlatform: boolean
  hasByok: boolean
  platformConfigured: boolean
  defaultModelSuggestion: string
  aiChatProvider: AiChatProvider
  localOpenAiBaseUrl: string | null
  localModel: string | null
  hasLocalApiKey: boolean
  defaultLocalModelSuggestion: string
  hasRoutstrKey: boolean
  routstrModel: string | null
  routstrPlatformConfigured: boolean
  defaultRoutstrModelSuggestion: string
}

export function AiModelsSettingsForm() {
  const [loading, setLoading] = useState(true)
  const [aiChatProvider, setAiChatProvider] = useState<AiChatProvider>("openrouter")
  const [model, setModel] = useState("")
  const [localOpenAiBaseUrl, setLocalOpenAiBaseUrl] = useState("")
  const [localModel, setLocalModel] = useState("")
  const [aiKeySource, setAiKeySource] = useState<AiSettingsResponse["aiKeySource"]>("auto")
  const [aiAllowPlatform, setAiAllowPlatform] = useState(true)
  const [hasByok, setHasByok] = useState(false)
  const [hasLocalApiKey, setHasLocalApiKey] = useState(false)
  const [platformConfigured, setPlatformConfigured] = useState(false)
  const [defaultModelSuggestion, setDefaultModelSuggestion] = useState("openai/gpt-4o-mini")
  const [defaultLocalModelSuggestion, setDefaultLocalModelSuggestion] = useState("llama3.2")
  const [hasRoutstrKey, setHasRoutstrKey] = useState(false)
  const [routstrModel, setRoutstrModel] = useState("")
  const [routstrPlatformConfigured, setRoutstrPlatformConfigured] = useState(false)
  const [defaultRoutstrModelSuggestion, setDefaultRoutstrModelSuggestion] = useState("meta-llama/llama-3.1-8b-instruct")
  const [newOpenrouterKey, setNewOpenrouterKey] = useState("")
  const [newLocalKey, setNewLocalKey] = useState("")
  const [newRoutstrKey, setNewRoutstrKey] = useState("")
  const [msg, setMsg] = useState("")
  const [ok, setOk] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setMsg("")
    try {
      const res = await fetch(withBase("/api/ai/settings"), { credentials: "include" })
      const j = (await res.json().catch(() => ({}))) as AiSettingsResponse & { error?: string }
      if (!res.ok) {
        setMsg(typeof j.error === "string" ? j.error : "Failed to load settings")
        return
      }
      setAiChatProvider(j.aiChatProvider === "local" ? "local" : j.aiChatProvider === "routstr" ? "routstr" : "openrouter")
      setModel(j.model ?? "")
      setLocalOpenAiBaseUrl(j.localOpenAiBaseUrl ?? "")
      setLocalModel(j.localModel ?? "")
      setAiKeySource(j.aiKeySource)
      setAiAllowPlatform(j.aiAllowPlatform)
      setHasByok(j.hasByok)
      setHasLocalApiKey(j.hasLocalApiKey)
      setPlatformConfigured(j.platformConfigured)
      setDefaultModelSuggestion(j.defaultModelSuggestion)
      setDefaultLocalModelSuggestion(j.defaultLocalModelSuggestion)
      setHasRoutstrKey(j.hasRoutstrKey)
      setRoutstrModel(j.routstrModel ?? "")
      setRoutstrPlatformConfigured(j.routstrPlatformConfigured)
      setDefaultRoutstrModelSuggestion(j.defaultRoutstrModelSuggestion)
    } catch {
      setMsg("Network error")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function save(opts: {
    openrouterKeyAction: "keep" | "set" | "clear"
    localKeyAction: "keep" | "set" | "clear"
    routstrKeyAction: "keep" | "set" | "clear"
  }) {
    setMsg("")
    setOk(false)
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        aiChatProvider,
        openrouterKeyAction: opts.openrouterKeyAction,
        localApiKeyAction: opts.localKeyAction,
        routstrKeyAction: opts.routstrKeyAction,
        model: model.trim() || null,
        localModel: localModel.trim() || null,
        localOpenAiBaseUrl: localOpenAiBaseUrl.trim() || null,
        routstrModel: routstrModel.trim() || null,
        aiKeySource,
        aiAllowPlatform,
      }
      if (opts.openrouterKeyAction === "set") {
        body.openrouterApiKey = newOpenrouterKey
      }
      if (opts.localKeyAction === "set") {
        body.localApiKey = newLocalKey
      }
      if (opts.routstrKeyAction === "set") {
        body.routstrApiKey = newRoutstrKey
      }
      const res = await fetch(withBase("/api/ai/settings"), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const j = (await res.json().catch(() => ({}))) as AiSettingsResponse & { error?: string }
      if (!res.ok) {
        setMsg(typeof j.error === "string" ? j.error : "Save failed")
        return
      }
      setOk(true)
      setNewOpenrouterKey("")
      setNewLocalKey("")
      setNewRoutstrKey("")
      setHasByok(j.hasByok)
      setHasLocalApiKey(j.hasLocalApiKey)
      setPlatformConfigured(j.platformConfigured)
      setDefaultModelSuggestion(j.defaultModelSuggestion)
      setDefaultLocalModelSuggestion(j.defaultLocalModelSuggestion)
      setHasRoutstrKey(j.hasRoutstrKey)
      setRoutstrPlatformConfigured(j.routstrPlatformConfigured)
    } catch {
      setMsg("Network error")
    } finally {
      setSubmitting(false)
    }
  }

  function onSaveClick() {
    const orAction = newOpenrouterKey.trim() ? ("set" as const) : ("keep" as const)
    const locAction = newLocalKey.trim() ? ("set" as const) : ("keep" as const)
    const rsAction = newRoutstrKey.trim() ? ("set" as const) : ("keep" as const)
    void save({ openrouterKeyAction: orAction, localKeyAction: locAction, routstrKeyAction: rsAction })
  }

  return (
    <section className="rounded-lg border border-border/40 bg-card/40 p-4">
      <h2 className="mb-1 text-sm font-medium text-muted-foreground">AI &amp; models</h2>
      <p className="mb-4 text-xs text-muted-foreground/85 leading-relaxed">
        Choose where chat requests go. Local mode talks to your own OpenAI-compatible server (Ollama, LM Studio, vLLM,
        etc.) and never registers models with OpenRouter. OpenRouter uses the cloud catalog or keys you configure below.
      </p>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-5">
          {msg ? <p className="text-sm text-amber-400/90">{msg}</p> : null}
          {ok ? <p className="text-sm text-emerald-400/90">Saved.</p> : null}

          <div>
            <span className="mb-2 block text-xs text-muted-foreground">Chat provider</span>
            <div className="space-y-2 text-sm">
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  name="aiChatProvider"
                  checked={aiChatProvider === "openrouter"}
                  onChange={() => setAiChatProvider("openrouter")}
                  className="mt-1"
                />
                <span>
                  <span className="text-foreground/90">OpenRouter</span>
                  <span className="block text-xs text-muted-foreground/80">
                    Hosted models via OpenRouter (operator key and/or your BYOK).
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  name="aiChatProvider"
                  checked={aiChatProvider === "routstr"}
                  onChange={() => setAiChatProvider("routstr")}
                  className="mt-1"
                />
                <span>
                  <span className="text-foreground/90">Routstr</span>
                  <span className="block text-xs text-muted-foreground/80">
                    Decentralized AI marketplace — pay per request with Bitcoin/Lightning via{" "}
                    <span className="font-mono text-[11px]">api.routstr.com</span>. Bring your own{" "}
                    <span className="font-mono text-[11px]">sk-</span> key.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  name="aiChatProvider"
                  checked={aiChatProvider === "local"}
                  onChange={() => setAiChatProvider("local")}
                  className="mt-1"
                />
                <span>
                  <span className="text-foreground/90">Local OpenAI-compatible API</span>
                  <span className="block text-xs text-muted-foreground/80">
                    Your machine or LAN — <span className="font-mono text-[11px]">/v1/chat/completions</span>. If the app
                    runs in Docker, use <span className="font-mono text-[11px]">host.docker.internal</span> or your host LAN
                    IP instead of <span className="font-mono text-[11px]">localhost</span>.
                  </span>
                </span>
              </label>
            </div>
          </div>

          {aiChatProvider === "routstr" ? (
            <div className="space-y-4 border-t border-border/30 pt-4">
              <p className="text-xs text-muted-foreground/85 leading-relaxed">
                Routstr routes requests through a decentralized network of AI providers. Fund a session at{" "}
                <a href="https://routstr.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  routstr.com
                </a>{" "}
                with Bitcoin/Lightning to receive a <span className="font-mono text-[11px]">sk-</span> API key, then paste it below.
              </p>
              <div>
                <label htmlFor="routstr-model" className="mb-1 block text-xs text-muted-foreground">
                  Default model id
                </label>
                <input
                  id="routstr-model"
                  type="text"
                  value={routstrModel}
                  onChange={(e) => setRoutstrModel(e.target.value)}
                  placeholder={defaultRoutstrModelSuggestion}
                  autoComplete="off"
                  className="w-full rounded-md border border-border/50 bg-background/80 px-3 py-2 font-mono text-sm outline-none focus:border-cyan-500/40"
                />
                <p className="mt-1 text-[11px] text-muted-foreground/70">
                  Suggested: <span className="font-mono">{defaultRoutstrModelSuggestion}</span>. You can override per-message in the assistant panel.
                </p>
              </div>
              <div>
                <label htmlFor="routstr-key" className="mb-1 block text-xs text-muted-foreground">
                  Routstr API key
                </label>
                <input
                  id="routstr-key"
                  type="password"
                  value={newRoutstrKey}
                  onChange={(e) => setNewRoutstrKey(e.target.value)}
                  placeholder={hasRoutstrKey ? "•••••••• (saved) — paste to replace" : "sk-…"}
                  autoComplete="off"
                  className="w-full rounded-md border border-border/50 bg-background/80 px-3 py-2 font-mono text-sm outline-none focus:border-cyan-500/40"
                />
                <p className="mt-1 text-[11px] text-muted-foreground/70">
                  Stored encrypted (AES-256-GCM). {hasRoutstrKey ? "A key is on file." : "No key stored."}{" "}
                  {routstrPlatformConfigured ? "Platform key configured as fallback." : ""}
                </p>
              </div>
              {!hasRoutstrKey && !routstrPlatformConfigured ? (
                <p className="text-xs text-amber-400/80">
                  No Routstr key configured. Add your key above, or ask the operator to set{" "}
                  <span className="font-mono text-[11px]">ROUTSTR_API_KEY</span>.
                </p>
              ) : null}
            </div>
          ) : aiChatProvider === "local" ? (
            <div className="space-y-4 border-t border-border/30 pt-4">
              <div>
                <label htmlFor="local-base" className="mb-1 block text-xs text-muted-foreground">
                  API base URL
                </label>
                <input
                  id="local-base"
                  type="url"
                  value={localOpenAiBaseUrl}
                  onChange={(e) => setLocalOpenAiBaseUrl(e.target.value)}
                  placeholder="http://127.0.0.1:11434/v1"
                  autoComplete="off"
                  className="w-full rounded-md border border-border/50 bg-background/80 px-3 py-2 font-mono text-sm outline-none focus:border-cyan-500/40"
                />
                <p className="mt-1 text-[11px] text-muted-foreground/70">
                  Root or <span className="font-mono">…/v1</span> is fine; the app normalizes to a <span className="font-mono">/v1</span> base.
                </p>
              </div>
              <div>
                <label htmlFor="local-model-def" className="mb-1 block text-xs text-muted-foreground">
                  Default model id
                </label>
                <input
                  id="local-model-def"
                  type="text"
                  value={localModel}
                  onChange={(e) => setLocalModel(e.target.value)}
                  placeholder={defaultLocalModelSuggestion}
                  autoComplete="off"
                  className="w-full rounded-md border border-border/50 bg-background/80 px-3 py-2 font-mono text-sm outline-none focus:border-cyan-500/40"
                />
                <p className="mt-1 text-[11px] text-muted-foreground/70">
                  Used when the assistant panel does not override the model. Suggested:{" "}
                  <span className="font-mono">{defaultLocalModelSuggestion}</span>.
                </p>
              </div>
              <div>
                <label htmlFor="local-key" className="mb-1 block text-xs text-muted-foreground">
                  API key (optional)
                </label>
                <input
                  id="local-key"
                  type="password"
                  value={newLocalKey}
                  onChange={(e) => setNewLocalKey(e.target.value)}
                  placeholder={hasLocalApiKey ? "•••••••• (saved) — paste to replace" : "Leave empty if the server has no auth"}
                  autoComplete="off"
                  className="w-full rounded-md border border-border/50 bg-background/80 px-3 py-2 font-mono text-sm outline-none focus:border-cyan-500/40"
                />
                <p className="mt-1 text-[11px] text-muted-foreground/70">
                  Stored encrypted like OpenRouter BYOK. {hasLocalApiKey ? "A key is on file." : "No key stored."}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4 border-t border-border/30 pt-4">
              <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground/85 leading-relaxed">
                <li>
                  <span className="text-foreground/90">Most users:</span> if the operator set{" "}
                  <span className="font-mono text-[11px]">OPENROUTER_API_KEY</span>, you may not need your own account.
                </li>
                <li>
                  <span className="text-foreground/90">BYOK:</span> paste your OpenRouter key below (encrypted at rest).
                </li>
              </ul>
              <div>
                <label htmlFor="ai-model" className="mb-1 block text-xs text-muted-foreground">
                  Default OpenRouter model id
                </label>
                <input
                  id="ai-model"
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={defaultModelSuggestion}
                  autoComplete="off"
                  className="w-full rounded-md border border-border/50 bg-background/80 px-3 py-2 font-mono text-sm outline-none focus:border-cyan-500/40"
                />
                <p className="mt-1 text-[11px] text-muted-foreground/70">
                  Browse ids at{" "}
                  <a
                    href="https://openrouter.ai/models"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    openrouter.ai/models
                  </a>
                  .
                </p>
              </div>

              <div>
                <span className="mb-2 block text-xs text-muted-foreground">OpenRouter API key mode</span>
                <div className="space-y-2 text-sm">
                  <label className="flex cursor-pointer items-start gap-2">
                    <input
                      type="radio"
                      name="aiKeySource"
                      checked={aiKeySource === "auto"}
                      onChange={() => setAiKeySource("auto")}
                      className="mt-1"
                    />
                    <span>
                      <span className="text-foreground/90">Auto</span>
                      <span className="block text-xs text-muted-foreground/80">
                        Use your key if saved, otherwise the platform key (when allowed).
                      </span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2">
                    <input
                      type="radio"
                      name="aiKeySource"
                      checked={aiKeySource === "byok_only"}
                      onChange={() => setAiKeySource("byok_only")}
                      className="mt-1"
                    />
                    <span>
                      <span className="text-foreground/90">My key only</span>
                      <span className="block text-xs text-muted-foreground/80">Never use the operator&apos;s OpenRouter key.</span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2">
                    <input
                      type="radio"
                      name="aiKeySource"
                      checked={aiKeySource === "platform_only"}
                      onChange={() => setAiKeySource("platform_only")}
                      className="mt-1"
                    />
                    <span>
                      <span className="text-foreground/90">Platform only</span>
                      <span className="block text-xs text-muted-foreground/80">
                        Use only the operator key (your saved key is ignored for requests).
                      </span>
                    </span>
                  </label>
                </div>
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={aiAllowPlatform}
                  onChange={(e) => setAiAllowPlatform(e.target.checked)}
                />
                <span>Allow platform billing when in Auto mode and I have no key</span>
              </label>

              {!platformConfigured && aiKeySource !== "byok_only" ? (
                <p className="text-xs text-amber-400/80">
                  Operator has not set <span className="font-mono">OPENROUTER_API_KEY</span> — platform mode will fail until
                  they do, unless you add your own key.
                </p>
              ) : null}

              <div>
                <label htmlFor="ai-or-key" className="mb-1 block text-xs text-muted-foreground">
                  OpenRouter API key (optional)
                </label>
                <input
                  id="ai-or-key"
                  type="password"
                  value={newOpenrouterKey}
                  onChange={(e) => setNewOpenrouterKey(e.target.value)}
                  placeholder={hasByok ? "•••••••• (saved) — paste to replace" : "sk-or-…"}
                  autoComplete="off"
                  className="w-full rounded-md border border-border/50 bg-background/80 px-3 py-2 font-mono text-sm outline-none focus:border-cyan-500/40"
                />
                <p className="mt-1 text-[11px] text-muted-foreground/70">
                  Status: {hasByok ? "A key is stored (masked)." : "No key stored."}
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 border-t border-border/30 pt-4">
            <button
              type="button"
              disabled={submitting}
              onClick={() => onSaveClick()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Save"}
            </button>
            {aiChatProvider === "openrouter" && hasByok ? (
              <button
                type="button"
                disabled={submitting}
                onClick={() => void save({ openrouterKeyAction: "clear", localKeyAction: "keep", routstrKeyAction: "keep" })}
                className="rounded-md border border-border/50 bg-background/60 px-4 py-2 text-sm text-muted-foreground hover:bg-background/90 disabled:opacity-50"
              >
                Remove OpenRouter key
              </button>
            ) : null}
            {aiChatProvider === "local" && hasLocalApiKey ? (
              <button
                type="button"
                disabled={submitting}
                onClick={() => void save({ openrouterKeyAction: "keep", localKeyAction: "clear", routstrKeyAction: "keep" })}
                className="rounded-md border border-border/50 bg-background/60 px-4 py-2 text-sm text-muted-foreground hover:bg-background/90 disabled:opacity-50"
              >
                Remove local API key
              </button>
            ) : null}
            {aiChatProvider === "routstr" && hasRoutstrKey ? (
              <button
                type="button"
                disabled={submitting}
                onClick={() => void save({ openrouterKeyAction: "keep", localKeyAction: "keep", routstrKeyAction: "clear" })}
                className="rounded-md border border-border/50 bg-background/60 px-4 py-2 text-sm text-muted-foreground hover:bg-background/90 disabled:opacity-50"
              >
                Remove Routstr key
              </button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  )
}
