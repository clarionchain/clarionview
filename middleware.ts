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

function isPublicLogicalPath(path: string): boolean {
  if (path === "/login") return true
  if (path === "/api/health") return true
  if (path.startsWith("/api/auth/")) return true
  if (path.startsWith("/_next/")) return true
  if (path === "/favicon.ico") return true
  if (/\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/i.test(path)) return true
  return false
}

function redirectToLogin(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone()
  url.pathname = BASE ? `${BASE}/login` : "/login"
  return NextResponse.redirect(url)
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const path = logicalPath(pathname)

  if (isPublicLogicalPath(path)) {
    if (path === "/login") {
      const token = request.cookies.get(SESSION_COOKIE)?.value
      if (token) {
        try {
          await jwtVerify(token, getSessionSecretBytes())
          const url = request.nextUrl.clone()
          url.pathname = BASE ? `${BASE}/` : "/"
          return NextResponse.redirect(url)
        } catch {
          /* invalid — show login */
        }
      }
    }
    return NextResponse.next()
  }

  const secret = getSessionSecretBytes()
  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (!token) {
    if (path.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Unauthorized", code: "WORKBENCH_SESSION" },
        { status: 401 }
      )
    }
    return redirectToLogin(request)
  }

  try {
    await jwtVerify(token, secret)
    const res = NextResponse.next()
    // Avoid stale cached HTML: shell can load without a fresh auth check while API calls get 401.
    if (!path.startsWith("/api/")) {
      res.headers.set("Cache-Control", "private, no-store, must-revalidate")
    }
    return res
  } catch {
    if (path.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Unauthorized", code: "WORKBENCH_SESSION" },
        { status: 401 }
      )
    }
    return redirectToLogin(request)
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
}
