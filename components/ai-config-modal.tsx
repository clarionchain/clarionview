"use client"

/**
 * AI configuration modal for anonymous (non-logged-in) users.
 * Lets guests either:
 *   1. Configure their own LLM key (stored in localStorage)
 *   2. Pay with Lightning for platform AI credits
 *   3. Pay with Cashu ecash for platform AI credits
 *
 * Credits and guest config are stored in localStorage under keys:
 *   clarionview:guest_ai_config   — BYOK settings
 *   clarionview:credit_token      — signed JWT from payment
 */

import { useState, useEffect, useCallback } from "react"
import { X, Zap, Key, Coins, CheckCircle, Loader2, Copy, RefreshCw, ExternalLink } from "lucide-react"
import { withBase } from "@/lib/base-path"

export const GUEST_CONFIG_KEY  = "clarionview:guest_ai_config"
export const CREDIT_TOKEN_KEY  = "clarionview:credit_token"

export type GuestAiConfig = {
  provider: "openrouter" | "local" | "routstr"
  apiKey?: string
  model?: string
  baseUrl?: string
}

export function loadGuestConfig(): GuestAiConfig | null {
  try {
    const raw = localStorage.getItem(GUEST_CONFIG_KEY)
    return raw ? (JSON.parse(raw) as GuestAiConfig) : null
  } catch { return null }
}

export function saveGuestConfig(cfg: GuestAiConfig): void {
  localStorage.setItem(GUEST_CONFIG_KEY, JSON.stringify(cfg))
}

export function loadCreditToken(): string | null {
  return localStorage.getItem(CREDIT_TOKEN_KEY)
}

export function saveCreditToken(token: string): void {
  localStorage.setItem(CREDIT_TOKEN_KEY, token)
}

export function clearGuestAi(): void {
  localStorage.removeItem(GUEST_CONFIG_KEY)
  localStorage.removeItem(CREDIT_TOKEN_KEY)
}

// ── Sub-panels ────────────────────────────────────────────────────────────────

function ByokPanel({ onSave }: { onSave: () => void }) {
  const [provider, setProvider] = useState<GuestAiConfig["provider"]>("openrouter")
  const [apiKey,  setApiKey]    = useState("")
  const [model,   setModel]     = useState("")
  const [baseUrl, setBaseUrl]   = useState("")
  const [saved,   setSaved]     = useState(false)

  useEffect(() => {
    const cfg = loadGuestConfig()
    if (cfg) {
      setProvider(cfg.provider)
      setApiKey(cfg.apiKey   ?? "")
      setModel(cfg.model     ?? "")
      setBaseUrl(cfg.baseUrl ?? "")
    }
  }, [])

  const save = () => {
    const cfg: GuestAiConfig = { provider, apiKey: apiKey.trim() || undefined,
                                  model: model.trim() || undefined,
                                  baseUrl: baseUrl.trim() || undefined }
    saveGuestConfig(cfg)
    setSaved(true)
    setTimeout(() => { setSaved(false); onSave() }, 800)
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Use your own API key. Keys are stored only in this browser — never sent to our servers except to proxy your request.
      </p>

      <div className="space-y-2">
        <label className="text-xs font-medium text-foreground">Provider</label>
        <div className="flex gap-2">
          {(["openrouter", "local", "routstr"] as const).map((p) => (
            <button key={p}
              onClick={() => setProvider(p)}
              className={`px-3 py-1.5 rounded text-xs border transition-colors ${
                provider === p
                  ? "border-cyan-500/60 bg-cyan-500/10 text-cyan-300"
                  : "border-border text-muted-foreground hover:border-border/80"
              }`}
            >
              {p === "openrouter" ? "OpenRouter" : p === "local" ? "Local / Ollama" : "Routstr"}
            </button>
          ))}
        </div>
      </div>

      {provider === "local" && (
        <div className="space-y-1">
          <label className="text-xs font-medium text-foreground">Base URL</label>
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="http://localhost:11434/v1"
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-cyan-500/40"
          />
        </div>
      )}

      <div className="space-y-1">
        <label className="text-xs font-medium text-foreground">
          {provider === "local" ? "API Key (optional)" : "API Key"}
        </label>
        <input value={apiKey} onChange={(e) => setApiKey(e.target.value)}
          type="password"
          placeholder={provider === "openrouter" ? "sk-or-..." : provider === "routstr" ? "rs-..." : "your-key"}
          className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-cyan-500/40"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-foreground">Model (optional)</label>
        <input value={model} onChange={(e) => setModel(e.target.value)}
          placeholder={
            provider === "openrouter" ? "anthropic/claude-3.5-haiku"
            : provider === "routstr"  ? "meta-llama/llama-3.1-8b-instruct"
            : "llama3.2"
          }
          className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-cyan-500/40"
        />
      </div>

      {provider === "openrouter" && (
        <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors"
        >
          <ExternalLink className="h-3 w-3" /> Get an OpenRouter API key
        </a>
      )}

      <button onClick={save}
        className="w-full rounded border border-cyan-500/40 bg-cyan-500/10 py-2 text-xs font-medium text-cyan-200 transition hover:bg-cyan-500/20"
      >
        {saved ? <span className="flex items-center justify-center gap-1.5"><CheckCircle className="h-3.5 w-3.5" /> Saved</span> : "Save Configuration"}
      </button>
    </div>
  )
}

function LightningPanel({ onPaid }: { onPaid: (token: string, credits: number) => void }) {
  const [invoice,    setInvoice]    = useState<{ payment_request: string; checking_id: string; amount_sats: number; credits: number } | null>(null)
  const [loading,    setLoading]    = useState(false)
  const [polling,    setPolling]    = useState(false)
  const [error,      setError]      = useState("")
  const [copied,     setCopied]     = useState(false)

  const createInvoice = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(withBase("/api/pay/lightning/invoice"), { method: "POST" })
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string }
        setError(j.error ?? "Failed to create invoice")
        return
      }
      const data = await res.json() as { payment_request: string; checking_id: string; amount_sats: number; credits: number }
      setInvoice(data)
      startPolling(data.checking_id)
    } catch {
      setError("Network error")
    } finally {
      setLoading(false)
    }
  }

  const startPolling = useCallback((checkingId: string) => {
    setPolling(true)
    let attempts = 0
    const max = 120 // 2 minutes
    const id = setInterval(async () => {
      attempts++
      if (attempts > max) { clearInterval(id); setPolling(false); return }
      try {
        const res  = await fetch(withBase(`/api/pay/lightning/verify/${checkingId}`))
        const data = await res.json() as { paid: boolean; token?: string; credits?: number }
        if (data.paid && data.token) {
          clearInterval(id)
          setPolling(false)
          saveCreditToken(data.token)
          onPaid(data.token, data.credits ?? 0)
        }
      } catch { /* keep polling */ }
    }, 1000)
  }, [onPaid])

  const copy = () => {
    if (!invoice) return
    navigator.clipboard.writeText(invoice.payment_request)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!invoice) {
    return (
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Pay with Lightning for AI credits. No account required. Credits are stored in this browser.
        </p>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button onClick={createInvoice} disabled={loading}
          className="w-full flex items-center justify-center gap-2 rounded border border-yellow-500/40 bg-yellow-500/10 py-2.5 text-xs font-medium text-yellow-200 transition hover:bg-yellow-500/20 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
          {loading ? "Creating invoice…" : "Generate Invoice"}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded border border-border bg-muted/30 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{invoice.amount_sats.toLocaleString()} sats → {invoice.credits} credits</span>
          {polling && (
            <span className="flex items-center gap-1 text-[10px] text-yellow-400/80">
              <Loader2 className="h-3 w-3 animate-spin" /> Waiting for payment…
            </span>
          )}
        </div>
        <p className="text-[10px] font-mono break-all text-muted-foreground/60 select-all">
          {invoice.payment_request.slice(0, 60)}…
        </p>
        <div className="flex gap-2">
          <a href={`lightning:${invoice.payment_request}`}
            className="flex-1 flex items-center justify-center gap-1.5 rounded border border-yellow-500/30 bg-yellow-500/10 py-1.5 text-xs text-yellow-200 hover:bg-yellow-500/20 transition"
          >
            <Zap className="h-3 w-3" /> Open Wallet
          </a>
          <button onClick={copy}
            className="flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition"
          >
            {copied ? <CheckCircle className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <button onClick={() => setInvoice(null)}
        className="flex items-center gap-1 text-[11px] text-muted-foreground/50 hover:text-foreground transition"
      >
        <RefreshCw className="h-3 w-3" /> New invoice
      </button>
    </div>
  )
}

function CashuPanel({ mintUrl, onPaid }: { mintUrl: string | null; onPaid: (token: string, credits: number) => void }) {
  const [tokenStr, setTokenStr] = useState("")
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState("")

  const redeem = async () => {
    if (!tokenStr.trim()) return
    setLoading(true)
    setError("")
    try {
      const res  = await fetch(withBase("/api/pay/cashu/redeem"), {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ token: tokenStr.trim() }),
      })
      const data = await res.json() as { ok?: boolean; token?: string; credits?: number; error?: string }
      if (!res.ok || !data.token) {
        setError(data.error ?? "Redemption failed")
        return
      }
      saveCreditToken(data.token)
      onPaid(data.token, data.credits ?? 0)
    } catch {
      setError("Network error")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Paste a Cashu ecash token to redeem for AI credits. No account required.
        {mintUrl && (
          <span className="block mt-1 text-muted-foreground/50">
            Accepted mint: <span className="font-mono">{mintUrl}</span>
          </span>
        )}
      </p>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <textarea value={tokenStr} onChange={(e) => setTokenStr(e.target.value)}
        placeholder="cashuA..."
        rows={3}
        className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs font-mono text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-cyan-500/40 resize-none"
      />
      <button onClick={redeem} disabled={loading || !tokenStr.trim()}
        className="w-full flex items-center justify-center gap-2 rounded border border-emerald-500/40 bg-emerald-500/10 py-2.5 text-xs font-medium text-emerald-200 transition hover:bg-emerald-500/20 disabled:opacity-40"
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Coins className="h-3.5 w-3.5" />}
        {loading ? "Redeeming…" : "Redeem Token"}
      </button>
    </div>
  )
}

// ── Main modal ────────────────────────────────────────────────────────────────

type Tab = "byok" | "lightning" | "cashu"

interface Props {
  onClose: () => void
  onConfigured: () => void
  defaultTab?: Tab
}

export function AiConfigModal({ onClose, onConfigured, defaultTab = "byok" }: Props) {
  const [tab,          setTab]          = useState<Tab>(defaultTab)
  const [payMethods,   setPayMethods]   = useState<{ lightning: boolean; cashu: boolean }>({ lightning: false, cashu: false })
  const [cashuMintUrl, setCashuMintUrl] = useState<string | null>(null)
  const [credits,      setCredits]      = useState<number | null>(null)
  const [success,      setSuccess]      = useState<string | null>(null)

  useEffect(() => {
    fetch(withBase("/api/pay/credits"))
      .then((r) => r.json())
      .then((d: { payment_methods?: { lightning: boolean; cashu: boolean }; cashu_mint_url?: string | null; balance?: { remaining: number } | null }) => {
        setPayMethods(d.payment_methods ?? { lightning: false, cashu: false })
        setCashuMintUrl(d.cashu_mint_url ?? null)
        if (d.balance) setCredits(d.balance.remaining)
      })
      .catch(() => {})
  }, [])

  const handlePaid = (_token: string, amount: number) => {
    setCredits(amount)
    setSuccess(`Payment received! ${amount} credits added.`)
    setTimeout(() => { setSuccess(null); onConfigured() }, 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="relative w-full max-w-md rounded-xl border border-border bg-card shadow-2xl mx-4">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Configure AI</h2>
            {credits !== null && (
              <p className="text-[11px] text-muted-foreground">{credits} credits remaining</p>
            )}
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:text-foreground transition">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Success flash */}
        {success && (
          <div className="flex items-center gap-2 border-b border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-xs text-emerald-300">
            <CheckCircle className="h-3.5 w-3.5 shrink-0" />
            {success}
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-border">
          <TabBtn active={tab === "byok"} onClick={() => setTab("byok")}>
            <Key className="h-3.5 w-3.5" /> Own Key
          </TabBtn>
          {payMethods.lightning && (
            <TabBtn active={tab === "lightning"} onClick={() => setTab("lightning")}>
              <Zap className="h-3.5 w-3.5" /> Lightning
            </TabBtn>
          )}
          {payMethods.cashu && (
            <TabBtn active={tab === "cashu"} onClick={() => setTab("cashu")}>
              <Coins className="h-3.5 w-3.5" /> Cashu
            </TabBtn>
          )}
        </div>

        {/* Panel */}
        <div className="p-4">
          {tab === "byok"      && <ByokPanel      onSave={onConfigured} />}
          {tab === "lightning" && <LightningPanel onPaid={handlePaid} />}
          {tab === "cashu"     && <CashuPanel     mintUrl={cashuMintUrl} onPaid={handlePaid} />}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-4 py-2.5 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground/50">
            Or{" "}
            <a href={withBase("/login")} className="text-muted-foreground/80 hover:text-foreground underline transition">
              sign in
            </a>{" "}
            for full account access
          </span>
        </div>
      </div>
    </div>
  )
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 flex-1 justify-center px-3 py-2.5 text-xs font-medium transition-colors border-b-2 ${
        active
          ? "border-cyan-500 text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  )
}
