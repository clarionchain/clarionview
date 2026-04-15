import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { jwtVerify } from "jose"
import { SESSION_COOKIE, getSessionSecretBytes } from "@/lib/auth-session"

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || ""

function logicalPath(pathname: string): string {
  if (BASE && pathname.startsWith(BASE)) {
    const rest = pathname.slice(BASE.length)
    return rest === "" ? "/" : rest.startsWith("/") ? rest : `/${rest}`
  }
  return pathname
}

/**
 * Routes that require an authenticated session.
 * Everything else is publicly accessible — no login required.
 */
function requiresAuth(path: string): boolean {
  if (path.startsWith("/account"))        return true
  if (path.startsWith("/admin"))          return true
  if (path.startsWith("/api/account/"))   return true
  if (path.startsWith("/api/admin/"))     return true
  if (path.startsWith("/api/workbooks/")) return true
  return false
}

function redirectToLogin(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone()
  url.pathname = BASE ? `${BASE}/login` : "/login"
  return NextResponse.redirect(url)
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Strip stale /workbench prefix (old bookmarks)
  if (!BASE && pathname.startsWith("/workbench")) {
    const stripped = pathname.slice("/workbench".length) || "/"
    const url = request.nextUrl.clone()
    url.pathname = stripped
    return NextResponse.redirect(url, 301)
  }

  const path = logicalPath(pathname)

  // If user visits login page while already authenticated → redirect home
  if (path === "/login") {
    const token = request.cookies.get(SESSION_COOKIE)?.value
    if (token) {
      try {
        await jwtVerify(token, getSessionSecretBytes())
        const url = request.nextUrl.clone()
        url.pathname = BASE ? `${BASE}/` : "/"
        return NextResponse.redirect(url)
      } catch { /* invalid — show login */ }
    }
    return NextResponse.next()
  }

  // Static assets and auth endpoints always pass through
  if (path === "/api/health")           return NextResponse.next()
  if (path.startsWith("/api/auth/"))    return NextResponse.next()
  if (path.startsWith("/_next/"))       return NextResponse.next()
  if (path === "/favicon.ico")          return NextResponse.next()
  if (/\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/i.test(path)) return NextResponse.next()

  // Routes that require authentication
  if (requiresAuth(path)) {
    const token = request.cookies.get(SESSION_COOKIE)?.value
    if (!token) {
      if (path.startsWith("/api/")) {
        return NextResponse.json({ error: "Unauthorized", code: "WORKBENCH_SESSION" }, { status: 401 })
      }
      return redirectToLogin(request)
    }
    try {
      await jwtVerify(token, getSessionSecretBytes())
    } catch {
      if (path.startsWith("/api/")) {
        return NextResponse.json({ error: "Unauthorized", code: "WORKBENCH_SESSION" }, { status: 401 })
      }
      return redirectToLogin(request)
    }
    const res = NextResponse.next()
    if (!path.startsWith("/api/")) {
      res.headers.set("Cache-Control", "private, no-store, must-revalidate")
    }
    return res
  }

  // All other routes are public
  // Auto-redirect authenticated mobile users from "/" to "/m"
  if (path === "/") {
    const ua = request.headers.get("user-agent") ?? ""
    if (/iPhone|Android|iPad|Mobile/i.test(ua)) {
      const token = request.cookies.get(SESSION_COOKIE)?.value
      if (token) {
        try {
          await jwtVerify(token, getSessionSecretBytes())
          const url = request.nextUrl.clone()
          url.pathname = BASE ? `${BASE}/m` : "/m"
          return NextResponse.redirect(url)
        } catch { /* not authenticated — serve desktop workbench */ }
      }
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
}
