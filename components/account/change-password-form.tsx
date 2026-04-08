"use client"

import { useState } from "react"
import { withBase } from "@/lib/base-path"

export function ChangePasswordForm({ title = "Change your password" }: { title?: string }) {
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState("")
  const [ok, setOk] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setMsg("")
    setOk(false)
    setSubmitting(true)
    try {
      const res = await fetch(withBase("/api/account/password"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setMsg(typeof j.error === "string" ? j.error : "Update failed")
        return
      }
      setOk(true)
      setCurrentPassword("")
      setNewPassword("")
    } catch {
      setMsg("Network error")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="rounded-lg border border-border/40 bg-card/40 p-4">
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">{title}</h2>
      <form onSubmit={onSubmit} className="space-y-3">
        {msg ? <p className="text-sm text-amber-400/90">{msg}</p> : null}
        {ok ? <p className="text-sm text-emerald-400/90">Password updated.</p> : null}
        <div>
          <label htmlFor="cp-cur" className="mb-1 block text-xs text-muted-foreground">
            Current password
          </label>
          <input
            id="cp-cur"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            className="w-full rounded-md border border-border/50 bg-background/80 px-3 py-2 text-sm outline-none focus:border-cyan-500/40"
          />
        </div>
        <div>
          <label htmlFor="cp-new" className="mb-1 block text-xs text-muted-foreground">
            New password (min 8 characters)
          </label>
          <input
            id="cp-new"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            className="w-full rounded-md border border-border/50 bg-background/80 px-3 py-2 text-sm outline-none focus:border-cyan-500/40"
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-cyan-600/80 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500/90 disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Update password"}
        </button>
      </form>
    </section>
  )
}
