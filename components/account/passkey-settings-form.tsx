"use client"

import { useCallback, useEffect, useState } from "react"
import { Fingerprint, Plus, Trash2, Loader2, CheckCircle, ShieldCheck } from "lucide-react"
import { withBase } from "@/lib/base-path"
import { cn } from "@/lib/utils"

interface PasskeyInfo {
  id: string
  name: string | null
  deviceType: string | null
  backedUp: boolean
  createdAt: string
}

export function PasskeySettingsForm() {
  const [passkeys, setPasskeys] = useState<PasskeyInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [registering, setRegistering] = useState(false)
  const [newName, setNewName] = useState("")
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(withBase("/api/auth/passkey"), { credentials: "include" })
      if (r.ok) setPasskeys(await r.json())
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function registerPasskey() {
    setMsg(null)
    setRegistering(true)
    try {
      // 1. Get options
      const optRes = await fetch(withBase("/api/auth/passkey"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "register-options" }),
      })
      if (!optRes.ok) {
        const b = await optRes.json().catch(() => ({})) as { error?: string }
        setMsg({ text: b.error ?? "Failed to start registration", ok: false })
        return
      }
      const options = await optRes.json()

      // 2. Prompt browser
      const { startRegistration } = await import("@simplewebauthn/browser")
      const response = await startRegistration({ optionsJSON: options })

      // 3. Verify + save
      const verRes = await fetch(withBase("/api/auth/passkey"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "register",
          name: newName.trim() || null,
          response,
        }),
      })
      const b = await verRes.json().catch(() => ({})) as { ok?: boolean; error?: string }
      if (!verRes.ok || !b.ok) {
        setMsg({ text: b.error ?? "Registration failed", ok: false })
        return
      }
      setMsg({ text: "Passkey registered! You can now use it to sign in.", ok: true })
      setNewName("")
      await load()
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "NotAllowedError") {
        setMsg({ text: "Cancelled or timed out", ok: false })
      } else {
        setMsg({ text: e instanceof Error ? e.message : "Registration error", ok: false })
      }
    } finally {
      setRegistering(false)
    }
  }

  async function remove(id: string) {
    try {
      const r = await fetch(withBase(`/api/auth/passkey?id=${encodeURIComponent(id)}`), {
        method: "DELETE",
        credentials: "include",
      })
      if (r.ok) await load()
    } catch { /* ignore */ }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  }

  return (
    <section className="rounded-lg border border-border/40 bg-card/40 p-4">
      <h2 className="mb-1 text-sm font-medium text-muted-foreground flex items-center gap-2">
        <Fingerprint className="h-4 w-4" />
        Passkeys
      </h2>
      <p className="mb-4 text-xs text-muted-foreground/60 leading-relaxed">
        Sign in with Face ID, Touch ID, or your device PIN — no password needed.
      </p>

      {msg && (
        <div className={cn(
          "flex items-start gap-2 rounded-md border px-3 py-2 text-xs mb-4",
          msg.ok
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
            : "border-red-500/30 bg-red-500/10 text-red-400"
        )}>
          {msg.ok ? <CheckCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : null}
          {msg.text}
        </div>
      )}

      {/* Existing passkeys */}
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground/50 mb-4">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading…
        </div>
      ) : passkeys.length > 0 ? (
        <ul className="mb-4 space-y-1.5">
          {passkeys.map((p) => (
            <li key={p.id} className="flex items-center gap-2 rounded-md border border-border/30 bg-background/40 px-3 py-2">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-400/70" />
              <div className="flex-1 min-w-0">
                <span className="text-xs text-foreground truncate">{p.name || "Passkey"}</span>
                <span className="text-[10px] text-muted-foreground/40 ml-2">{formatDate(p.createdAt)}</span>
                {p.backedUp && (
                  <span className="text-[10px] text-cyan-400/60 ml-1.5">synced</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => remove(p.id)}
                className="p-1 text-muted-foreground/30 hover:text-destructive/70 rounded transition-colors shrink-0"
                title="Remove"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground/40 mb-4">No passkeys registered yet.</p>
      )}

      {/* Register new */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder='Name (e.g. "iPhone")'
          className="flex-1 rounded-md border border-border/50 bg-background/80 px-3 py-1.5 text-xs outline-none focus:border-cyan-500/40"
        />
        <button
          type="button"
          onClick={registerPasskey}
          disabled={registering}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 shrink-0"
        >
          {registering
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <Plus className="h-3 w-3" />
          }
          {registering ? "Registering…" : "Add passkey"}
        </button>
      </div>
    </section>
  )
}
