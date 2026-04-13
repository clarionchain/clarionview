"use client"

import { Suspense, useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { LoginBackdrop } from "@/components/login/login-backdrop"
import { withBase } from "@/lib/base-path"
import { Fingerprint, Loader2, Mail, CheckCircle } from "lucide-react"

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()

  const [username, setUsername] = useState("admin")
  const [password, setPassword] = useState("")
  const [email, setEmail] = useState("")
  const [err, setErr] = useState("")
  const [loading, setLoading] = useState(false)
  const [passkeyLoading, setPasskeyLoading] = useState(false)
  const [magicLoading, setMagicLoading] = useState(false)
  const [magicSent, setMagicSent] = useState(false)
  const [mode, setMode] = useState<"passkey" | "magic" | "password">("passkey")

  // Handle magic link token in URL (?token=…)
  useEffect(() => {
    const token = params.get("token")
    if (!token) {
      if (params.get("error") === "expired") setErr("Magic link expired — please request a new one.")
      return
    }
    setLoading(true)
    fetch(withBase(`/api/auth/magic?token=${encodeURIComponent(token)}`), {
      credentials: "include",
      redirect: "follow",
    }).then((res) => {
      if (res.redirected || res.ok) {
        router.push(withBase("/"))
        router.refresh()
      } else {
        setErr("Magic link invalid or expired.")
        setLoading(false)
      }
    }).catch(() => {
      setErr("Network error verifying link.")
      setLoading(false)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onPasswordSubmit(e: React.FormEvent) {
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
      router.push(withBase("/"))
      router.refresh()
    } catch {
      setErr("Network error")
    } finally {
      setLoading(false)
    }
  }

  async function signInWithPasskey() {
    setErr("")
    setPasskeyLoading(true)
    try {
      const optRes = await fetch(withBase("/api/auth/passkey"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "login-options" }),
      })
      if (!optRes.ok) {
        const b = await optRes.json().catch(() => ({})) as { error?: string }
        setErr(b.error ?? "Failed to get passkey options")
        return
      }
      const options = await optRes.json()
      const sessionKey = options._sessionKey

      const { startAuthentication } = await import("@simplewebauthn/browser")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await startAuthentication({ optionsJSON: options as any })

      const verRes = await fetch(withBase("/api/auth/passkey"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "login", sessionKey, response }),
      })
      if (!verRes.ok) {
        const b = await verRes.json().catch(() => ({})) as { error?: string }
        setErr(b.error ?? "Passkey authentication failed")
        return
      }
      router.push(withBase("/"))
      router.refresh()
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "NotAllowedError") {
        setErr("Cancelled")
      } else if (e instanceof Error) {
        setErr(e.message)
      } else {
        setErr("Passkey error")
      }
    } finally {
      setPasskeyLoading(false)
    }
  }

  async function sendMagicLink() {
    setErr("")
    if (!email.trim()) { setErr("Enter your email address"); return }
    setMagicLoading(true)
    try {
      await fetch(withBase("/api/auth/magic"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim() }),
      })
      setMagicSent(true)
    } catch {
      setErr("Network error")
    } finally {
      setMagicLoading(false)
    }
  }

  if (loading && params.get("token")) {
    return (
      <div className="absolute bottom-5 left-4 z-10 sm:bottom-6 sm:left-6">
        <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />
      </div>
    )
  }

  return (
    <div className="absolute bottom-5 left-4 z-10 flex w-[220px] flex-col gap-2 sm:bottom-6 sm:left-6">

      {err && <p className="text-[10px] text-red-400/90">{err}</p>}

      {/* Magic link sent confirmation */}
      {mode === "magic" && magicSent ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-emerald-400/90">
            <CheckCircle className="h-4 w-4 shrink-0" />
            <span className="text-xs">Check your email for a sign-in link.</span>
          </div>
          <button onClick={() => { setMagicSent(false); setMode("password"); setErr("") }} className="text-[10px] text-white/30 hover:text-white/50 text-left">
            ← Back
          </button>
        </div>
      ) : (
        <>
          {/* Passkey button — always shown unless in magic mode */}
          {mode !== "magic" && (
            <button
              type="button"
              onClick={signInWithPasskey}
              disabled={passkeyLoading}
              className="flex items-center justify-center gap-2 rounded border border-cyan-500/40 bg-cyan-500/20 py-2 text-xs font-medium text-cyan-100/90 transition hover:bg-cyan-500/30 disabled:opacity-50"
            >
              {passkeyLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Fingerprint className="h-3.5 w-3.5" />}
              {passkeyLoading ? "Authenticating…" : "Sign in with passkey"}
            </button>
          )}

          {/* Password form — shown in password/passkey mode */}
          {mode !== "magic" && (
            <form onSubmit={onPasswordSubmit} className="flex flex-col gap-1.5">
              <input
                name="username"
                autoComplete="username"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="rounded border border-white/15 bg-black/50 px-2 py-1.5 text-xs text-white placeholder:text-white/35 outline-none backdrop-blur-sm focus:border-white/30"
              />
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded border border-white/15 bg-black/50 px-2 py-1.5 text-xs text-white placeholder:text-white/35 outline-none backdrop-blur-sm focus:border-white/30"
              />
              <div className="flex gap-1.5">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 rounded border border-white/15 bg-white/5 py-1.5 text-xs font-medium text-white/60 transition hover:bg-white/10 disabled:opacity-50"
                >
                  {loading ? "…" : "Sign in"}
                </button>
                <button
                  type="button"
                  onClick={() => { setMode("magic"); setErr("") }}
                  className="rounded border border-white/10 bg-white/5 px-2 py-1.5 text-[11px] text-white/40 hover:text-white/60 transition"
                  title="Email magic link"
                >
                  <Mail className="h-3 w-3" />
                </button>
              </div>
            </form>
          )}

          {/* Magic link email form */}
          {mode === "magic" && (
            <>
              <div className="flex items-center gap-1.5">
                <button onClick={() => { setMode("passkey"); setErr("") }} className="text-[10px] text-white/30 hover:text-white/50">←</button>
                <span className="text-[11px] text-white/40">Email magic link</span>
              </div>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMagicLink()}
                placeholder="your@email.com"
                autoFocus
                className="rounded border border-white/15 bg-black/50 px-2 py-1.5 text-xs text-white placeholder:text-white/35 outline-none backdrop-blur-sm focus:border-cyan-500/40"
              />
              <button
                type="button"
                onClick={sendMagicLink}
                disabled={magicLoading}
                className="flex items-center justify-center gap-2 rounded border border-cyan-500/40 bg-cyan-500/20 py-2 text-xs font-medium text-cyan-100/90 transition hover:bg-cyan-500/30 disabled:opacity-50"
              >
                {magicLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                {magicLoading ? "Sending…" : "Send link"}
              </button>
            </>
          )}
        </>
      )}
    </div>
  )
}

export default function LoginPage() {
  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-black text-white">
      <LoginBackdrop />
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  )
}
