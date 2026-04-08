"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { withBase } from "@/lib/base-path"
import { ChangePasswordForm } from "@/components/account/change-password-form"

type ListedUserRow = { id: number; username: string; is_admin: boolean; created_at: string }

export function AdminUsersClient() {
  const [users, setUsers] = useState<ListedUserRow[]>([])
  const [selfId, setSelfId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const [editingId, setEditingId] = useState<number | null>(null)
  const [editUsername, setEditUsername] = useState("")
  const [editPassword, setEditPassword] = useState("")
  const [editErr, setEditErr] = useState("")
  const [editSaving, setEditSaving] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setErr("")
    Promise.all([
      fetch(withBase("/api/admin/users"), { credentials: "include" }).then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`)
        return r.json() as Promise<ListedUserRow[]>
      }),
      fetch(withBase("/api/account/me"), { credentials: "include" }).then(async (r) => {
        if (!r.ok) return null
        return r.json() as Promise<{ id: number }>
      }),
    ])
      .then(([list, me]) => {
        setUsers(list)
        setSelfId(me?.id ?? null)
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function openEdit(u: ListedUserRow) {
    setEditingId(u.id)
    setEditUsername(u.username)
    setEditPassword("")
    setEditErr("")
  }

  function closeEdit() {
    setEditingId(null)
    setEditErr("")
  }

  async function onSaveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (editingId == null) return
    setEditErr("")
    const uTrim = editUsername.trim()
    if (uTrim.length < 1) {
      setEditErr("Username required")
      return
    }
    if (!editPassword && users.find((x) => x.id === editingId)?.username === uTrim) {
      setEditErr("Change username or enter a new password")
      return
    }
    setEditSaving(true)
    try {
      const body: { username: string; password?: string } = { username: uTrim }
      if (editPassword.length > 0) body.password = editPassword
      const res = await fetch(withBase(`/api/admin/users/${editingId}`), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setEditErr(typeof j.error === "string" ? j.error : "Save failed")
        return
      }
      closeEdit()
      load()
    } catch {
      setEditErr("Network error")
    } finally {
      setEditSaving(false)
    }
  }

  async function onDeleteUser(targetId: number) {
    if (!confirm("Delete this user and all of their workbooks? This cannot be undone.")) return
    setEditErr("")
    try {
      const res = await fetch(withBase(`/api/admin/users/${targetId}`), {
        method: "DELETE",
        credentials: "include",
      })
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setEditErr(typeof j.error === "string" ? j.error : "Delete failed")
        return
      }
      closeEdit()
      load()
    } catch {
      setEditErr("Network error")
    }
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    setErr("")
    setSubmitting(true)
    try {
      const res = await fetch(withBase("/api/admin/users"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setErr(typeof j.error === "string" ? j.error : "Create failed")
        return
      }
      setUsername("")
      setPassword("")
      load()
    } catch {
      setErr("Network error")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-8 text-foreground">
      <div>
        <Link href="/" className="text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors">
          ← Back to workbench
        </Link>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">User accounts</h1>
        <p className="mt-2 text-sm text-muted-foreground/80">
          Private app — no public sign-up. Admins can manage accounts here; everyone can change their own password
          under <Link href={withBase("/account")} className="text-cyan-500/80 hover:text-cyan-400">Preferences</Link>. Each
          user has
          their own saved workbooks (SQLite on the server volume).
        </p>
      </div>

      {err ? <p className="text-sm text-amber-400/90">{err}</p> : null}

      <ChangePasswordForm title="Your password" />

      <section className="rounded-lg border border-border/40 bg-card/40 p-4">
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Existing users</h2>
        {loading ? (
          <p className="text-sm text-muted-foreground/60">Loading…</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {users.map((u) => (
              <li
                key={u.id}
                className="rounded-md border border-border/20 bg-background/40 px-3 py-2 space-y-2"
              >
                {editingId === u.id ? (
                  <form onSubmit={onSaveEdit} className="space-y-2">
                    {editErr ? <p className="text-xs text-amber-400/90">{editErr}</p> : null}
                    <div>
                      <label className="mb-0.5 block text-[11px] text-muted-foreground">Username</label>
                      <input
                        value={editUsername}
                        onChange={(e) => setEditUsername(e.target.value)}
                        autoComplete="off"
                        className="w-full rounded-md border border-border/50 bg-background/80 px-2 py-1.5 text-sm font-mono outline-none focus:border-cyan-500/40"
                      />
                    </div>
                    <div>
                      <label className="mb-0.5 block text-[11px] text-muted-foreground">
                        New password (optional, min 8 characters)
                      </label>
                      <input
                        type="password"
                        value={editPassword}
                        onChange={(e) => setEditPassword(e.target.value)}
                        autoComplete="new-password"
                        className="w-full rounded-md border border-border/50 bg-background/80 px-2 py-1.5 text-sm outline-none focus:border-cyan-500/40"
                      />
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="submit"
                        disabled={editSaving}
                        className="rounded-md bg-cyan-600/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-500/90 disabled:opacity-50"
                      >
                        {editSaving ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={closeEdit}
                        className="rounded-md border border-border/50 px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent/30"
                      >
                        Cancel
                      </button>
                      {selfId !== u.id ? (
                        <button
                          type="button"
                          onClick={() => onDeleteUser(u.id)}
                          className="rounded-md border border-red-900/50 bg-red-950/30 px-3 py-1.5 text-xs text-red-300/90 hover:bg-red-950/50"
                        >
                          Delete user
                        </button>
                      ) : null}
                    </div>
                  </form>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-mono text-foreground/90">{u.username}</span>
                      <span className="ml-2 text-xs text-muted-foreground/60">
                        {u.is_admin ? "admin" : "user"} · id {u.id}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => openEdit(u)}
                      className="shrink-0 rounded-md border border-border/50 px-2 py-1 text-xs text-muted-foreground hover:bg-accent/30 hover:text-foreground"
                    >
                      Edit
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-border/40 bg-card/40 p-4">
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Create user</h2>
        <form onSubmit={onCreate} className="space-y-3">
          <div>
            <label htmlFor="nu" className="mb-1 block text-xs text-muted-foreground">
              Username
            </label>
            <input
              id="nu"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              className="w-full rounded-md border border-border/50 bg-background/80 px-3 py-2 text-sm outline-none focus:border-cyan-500/40"
            />
          </div>
          <div>
            <label htmlFor="np" className="mb-1 block text-xs text-muted-foreground">
              Password (min 8 characters)
            </label>
            <input
              id="np"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full rounded-md border border-border/50 bg-background/80 px-3 py-2 text-sm outline-none focus:border-cyan-500/40"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-cyan-600/80 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500/90 disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create user"}
          </button>
        </form>
      </section>
    </div>
  )
}
