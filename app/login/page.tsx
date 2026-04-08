"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { LoginBackdrop } from "@/components/login/login-backdrop"
import { withBase } from "@/lib/base-path"

export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState("admin")
  const [password, setPassword] = useState("")
  const [err, setErr] = useState("")
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr("")
    setLoading(true)
    try {
      const res = await fetch(withBase("/api/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setErr(typeof j.error === "string" ? j.error : "Login failed")
        return
      }
      router.push("/")
      router.refresh()
    } catch {
      setErr("Network error")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-black text-white">
      <LoginBackdrop />

      <form
        onSubmit={onSubmit}
        className="absolute bottom-5 left-4 z-10 flex w-[200px] flex-col gap-1.5 sm:bottom-6 sm:left-6"
        aria-label="Sign in"
      >
        <input
          name="username"
          autoComplete="username"
          aria-label="Username"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="rounded border border-white/15 bg-black/50 px-2 py-1.5 text-xs text-white placeholder:text-white/35 outline-none backdrop-blur-sm focus:border-cyan-500/40"
        />
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          aria-label="Password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded border border-white/15 bg-black/50 px-2 py-1.5 text-xs text-white placeholder:text-white/35 outline-none backdrop-blur-sm focus:border-cyan-500/40"
        />
        {err ? <p className="text-[10px] text-red-400/90">{err}</p> : null}
        <button
          type="submit"
          disabled={loading}
          className="rounded border border-cyan-500/30 bg-cyan-500/15 py-1.5 text-xs font-medium text-cyan-100/90 transition hover:bg-cyan-500/25 disabled:opacity-50"
        >
          {loading ? "…" : "Sign in"}
        </button>
      </form>
    </main>
  )
}
