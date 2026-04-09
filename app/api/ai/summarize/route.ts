import { NextResponse } from "next/server"
import { JSDOM } from "jsdom"
import { Readability } from "@mozilla/readability"
import { requireUser } from "@/lib/api-auth"
import { resolveChatTarget } from "@/lib/chat-target-resolve"

export type SummarizeLength = "short" | "medium" | "long" | "xl"

const LENGTH_INSTRUCTIONS: Record<SummarizeLength, string> = {
  short: "Write a concise summary of around 150-250 words.",
  medium: "Write a thorough summary of around 350-500 words.",
  long: "Write a detailed summary of around 700-900 words covering all major points.",
  xl: "Write a comprehensive, structured summary of around 1,200-1,800 words with headers and sub-sections.",
}

const BLOCKED_HOSTS = new Set([
  "169.254.169.254",
  "metadata.google.internal",
  "metadata.goog",
  "localhost",
  "127.0.0.1",
  "::1",
])

function isSafeUrl(raw: string): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, error: "Invalid URL" }
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Only http and https URLs are supported" }
  }
  const host = url.hostname.toLowerCase()
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".internal") || host.endsWith(".local")) {
    return { ok: false, error: "URL hostname is not allowed" }
  }
  return { ok: true, url }
}

async function fetchAndExtract(url: URL): Promise<{ title: string; content: string; byline: string | null }> {
  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; ClarionView/1.0; +https://clarionview.io) AppleWebKit/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    throw new Error(`Failed to fetch URL: HTTP ${res.status}`)
  }

  const contentType = res.headers.get("content-type") ?? ""
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
    throw new Error(`URL does not return HTML (content-type: ${contentType.split(";")[0]})`)
  }

  const html = await res.text()
  if (html.length > 5_000_000) {
    throw new Error("Page is too large to process (>5MB)")
  }

  const dom = new JSDOM(html, { url: url.toString() })
  const reader = new Readability(dom.window.document)
  const article = reader.parse()

  if (!article || !article.textContent || article.textContent.trim().length < 50) {
    throw new Error("Could not extract readable content from this page. It may require JavaScript to render.")
  }

  // Trim content to avoid overflowing context windows
  const content = article.textContent.trim().slice(0, 80_000)
  return {
    title: article.title || url.hostname,
    content,
    byline: article.byline || null,
  }
}

function buildSummarizeMessages(
  article: { title: string; content: string; byline: string | null },
  url: URL,
  length: SummarizeLength
): { role: "system" | "user"; content: string }[] {
  const system =
    "You are an expert content analyst and summarizer. Produce clear, accurate summaries that capture the key ideas, arguments, and important details. Format output as markdown. Do not pad with filler phrases."

  const bylineStr = article.byline ? `\nAuthor: ${article.byline}` : ""

  const user = `Summarize the following article. ${LENGTH_INSTRUCTIONS[length]}

Title: ${article.title}
URL: ${url.toString()}${bylineStr}

--- ARTICLE CONTENT ---
${article.content}
--- END ARTICLE ---`

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

export async function POST(req: Request) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const rawUrl = body.url
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    return NextResponse.json({ error: "url is required" }, { status: 400 })
  }

  const lengthRaw = body.length ?? "medium"
  const length: SummarizeLength =
    lengthRaw === "short" || lengthRaw === "medium" || lengthRaw === "long" || lengthRaw === "xl"
      ? lengthRaw
      : "medium"

  const modelOverride = typeof body.model === "string" && body.model.trim() ? body.model.trim() : null

  const safeUrl = isSafeUrl(rawUrl.trim())
  if (!safeUrl.ok) {
    return NextResponse.json({ error: safeUrl.error }, { status: 400 })
  }

  // Resolve AI target (same as chat)
  const target = resolveChatTarget(auth.userId, modelOverride)
  if (!target.ok) {
    return NextResponse.json({ error: target.message, code: target.code }, { status: target.status })
  }

  // Fetch and extract content
  let article: { title: string; content: string; byline: string | null }
  try {
    article = await fetchAndExtract(safeUrl.url)
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to fetch URL"
    return NextResponse.json({ error: msg }, { status: 422 })
  }

  const messages = buildSummarizeMessages(article, safeUrl.url, length)

  // Forward to AI provider
  const upstream = await fetch(target.url, {
    method: "POST",
    headers: target.headers,
    body: JSON.stringify({
      model: target.model,
      messages,
      stream: true,
      temperature: 0.3,
    }),
  })

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => "")
    let errMsg = `AI provider error (${upstream.status})`
    try {
      const j = JSON.parse(errText) as { error?: { message?: string } | string }
      const m = typeof j.error === "string" ? j.error : j.error?.message
      if (m) errMsg = m
    } catch { /* ignore */ }
    return NextResponse.json({ error: errMsg }, { status: 502 })
  }

  // Pass the title back in a header so the UI can display it
  const responseHeaders = new Headers({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "X-Summarize-Title": encodeURIComponent(article.title.slice(0, 200)),
    "X-Summarize-Url": encodeURIComponent(safeUrl.url.toString().slice(0, 500)),
  })

  return new NextResponse(upstream.body, { headers: responseHeaders })
}
