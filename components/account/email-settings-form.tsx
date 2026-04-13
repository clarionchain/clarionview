"use client"

import { useCallback, useEffect, useState } from "react"
import { Mail, Loader2, CheckCircle } from "lucide-react"
import { withBase } from "@/lib/base-path"
import { cn } from "@/lib/utils"

export function EmailSettingsForm() {
  const [email, setEmail] = useState("")
  const [saved, setSaved] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(withBase("/api/account/me"), { credentials: "include" })
      if (r.ok) {
        const d = await r.json() as { email?: string | null }
        const e = d.email ?? ""
        setEmail(e)
        setSaved(e)
      }
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function save() {
    setMsg(null)
    setSaving(true)
    try {
      const r = await fetch(withBase("/api/account/me"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim() || null }),
      })
      const b = await r.json().catch(() => ({})) as { ok?: boolean; error?: string }
      if (!r.ok || !b.ok) {
        setMsg({ text: b.error ?? "Save failed", ok: false })
        return
      }
      setSaved(email.trim())
      setMsg({ text: "Email saved. Magic link login will use this address.", ok: true })
    } catch {
      setMsg({ text: "Network error", ok: false })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-lg border border-border/40 bg-card/40 p-4">
      <h2 className="mb-1 text-sm font-medium text-muted-foreground flex items-center gap-2">
        <Mail className="h-4 w-4" />
        Email address
      </h2>
      <p className="mb-4 text-xs text-muted-foreground/60 leading-relaxed">
        Used for magic link sign-in — enter your email on the login page to receive a one-click sign-in link.
      </p>

      {msg && (
        <div className={cn(
          "flex items-center gap-2 rounded-md border px-3 py-2 text-xs mb-4",
          msg.ok
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
            : "border-red-500/30 bg-red-500/10 text-red-400"
        )}>
          {msg.ok && <CheckCircle className="h-3.5 w-3.5 shrink-0" />}
          {msg.text}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground/50">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading…
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            className="flex-1 rounded-md border border-border/50 bg-background/80 px-3 py-1.5 text-sm outline-none focus:border-cyan-500/40"
          />
          <button
            type="button"
            onClick={save}
            disabled={saving || email.trim() === saved}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 shrink-0"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
          </button>
        </div>
      )}
    </section>
  )
}
