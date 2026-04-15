import { NextResponse } from "next/server"
import { getSessionUserId } from "@/lib/api-auth"
import { logAiUsage } from "@/lib/ai-usage-log"
import { resolveChatTarget, resolveGuestTarget } from "@/lib/chat-target-resolve"
import { consumeCredit } from "@/lib/anon-credits"
import { resolveOpenRouterForUser } from "@/lib/openrouter-resolve"

const ALLOWED_ROLES = new Set(["system", "user", "assistant", "tool"])
const MAX_CHART_CONTEXT_CHARS = 48_000
const MAX_MESSAGES = 80

// Guest config passed inline from browser localStorage
export type GuestConfig = {
  provider: "openrouter" | "local" | "routstr"
  apiKey?: string
  model?: string
  baseUrl?: string
}

type ChatMessageContent = string | { type: string; text?: string; image_url?: { url: string } }[]
type ChatMessage = { role: string; content: ChatMessageContent }

function mergeChartContext(messages: ChatMessage[], chartContext: unknown): ChatMessage[] | null {
  if (chartContext === undefined) return messages
  if (chartContext !== null && typeof chartContext !== "string") return null
  const raw = typeof chartContext === "string" ? chartContext.trim() : ""
  if (raw === "") return messages
  const ctx = raw.slice(0, MAX_CHART_CONTEXT_CHARS)
  const prefix =
    "## Chart & workbook context (current workbench view)\n\n" +
    ctx +
    "\n\n---\n\nTreat the section above as the user's current chart state. Do not invent series or values that are not listed there."
  const first = messages[0]
  if (first?.role === "system") {
    return [{ role: "system", content: `${prefix}\n\n${first.content}` }, ...messages.slice(1)]
  }
  return [{ role: "system", content: prefix }, ...messages]
}

function validateMessages(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MESSAGES) return null
  const out: ChatMessage[] = []
  for (const m of raw) {
    if (!m || typeof m !== "object") return null
    const role    = (m as { role?: unknown }).role
    const content = (m as { content?: unknown }).content
    if (typeof role !== "string") return null
    if (!ALLOWED_ROLES.has(role)) return null
    if (typeof content === "string") {
      if (content.length > 200_000) return null
      out.push({ role, content })
    } else if (Array.isArray(content)) {
      out.push({ role, content: content as ChatMessageContent })
    } else {
      return null
    }
  }
  return out
}

export async function POST(req: Request) {
  let body: {
    messages?: unknown
    model?: unknown
    stream?: unknown
    chartContext?: unknown
    guestConfig?: unknown
    creditToken?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const baseMessages = validateMessages(body.messages)
  if (!baseMessages) {
    return NextResponse.json(
      { error: `Invalid messages: need 1–${MAX_MESSAGES} items with role and string content` },
      { status: 400 }
    )
  }

  const messages = mergeChartContext(baseMessages, body.chartContext)
  if (!messages) {
    return NextResponse.json({ error: "Invalid chartContext" }, { status: 400 })
  }
  if (messages.length > MAX_MESSAGES) {
    return NextResponse.json({ error: `Too many messages (max ${MAX_MESSAGES})` }, { status: 400 })
  }

  const stream        = body.stream === true
  const modelOverride = typeof body.model === "string" ? body.model : null

  // ── Resolve who is calling and how to route to LLM ────────────────────────

  const userId = await getSessionUserId()

  let resolved: Awaited<ReturnType<typeof resolveChatTarget>>
  let logUserId: number | null = null
  let creditToken: string | null = null

  if (userId !== null) {
    // Authenticated user — use DB settings (existing behavior)
    resolved  = resolveChatTarget(userId, modelOverride)
    logUserId = userId
  } else if (body.guestConfig && typeof body.guestConfig === "object") {
    // Anonymous user with their own API key (BYOK stored in browser)
    resolved = resolveGuestTarget(body.guestConfig as GuestConfig, modelOverride)
  } else if (typeof body.creditToken === "string" && body.creditToken.trim()) {
    // Anonymous user with purchased credits — use platform LLM key
    creditToken = body.creditToken.trim()
    const creditCheck = await consumeCredit(creditToken)
    if (!creditCheck.ok) {
      return NextResponse.json(
        { error: creditCheck.error, code: "CREDITS_EXHAUSTED" },
        { status: 402 }
      )
    }
    // Route via platform OpenRouter key (userId -1 = anonymous credit user)
    const platformKey = process.env.OPENROUTER_API_KEY?.trim()
    if (!platformKey) {
      return NextResponse.json({ error: "Platform LLM not configured" }, { status: 503 })
    }
    const model = modelOverride?.trim() || process.env.OPENROUTER_DEFAULT_MODEL?.trim() || "anthropic/claude-3.5-haiku"
    const headers: Record<string, string> = {
      Authorization:  `Bearer ${platformKey}`,
      "Content-Type": "application/json",
      "X-Title":      process.env.OPENROUTER_APP_TITLE?.trim() || "ClarionView",
    }
    const ref = process.env.OPENROUTER_HTTP_REFERER?.trim()
    if (ref) headers["HTTP-Referer"] = ref
    resolved = {
      ok:        true,
      kind:      "openrouter" as const,
      url:       "https://openrouter.ai/api/v1/chat/completions",
      apiKey:    platformKey,
      model,
      headers,
      logSource: "platform" as const,
    }
  } else {
    // No configuration at all — tell the client to configure
    return NextResponse.json(
      {
        error: "Configure your LLM or purchase credits to use AI features.",
        code:  "NO_AI_CONFIG",
      },
      { status: 402 }
    )
  }

  if (!resolved.ok) {
    return NextResponse.json(
      { error: resolved.message, code: resolved.code },
      { status: resolved.status }
    )
  }

  const upstream = await fetch(resolved.url, {
    method:  "POST",
    headers: resolved.headers,
    body:    JSON.stringify({ model: resolved.model, messages, stream }),
  })

  if (!upstream.ok) {
    const t = await upstream.text()
    let errMsg = resolved.kind === "local" ? "Local model request failed" : "OpenRouter request failed"
    try {
      const j = JSON.parse(t) as { error?: { message?: string } | string }
      if (typeof j.error === "object" && j.error && typeof j.error.message === "string") {
        errMsg = j.error.message
      } else if (typeof j.error === "string") {
        errMsg = j.error
      }
    } catch { /* keep default */ }
    return NextResponse.json(
      { error: errMsg, detail: t.length > 2000 ? `${t.slice(0, 2000)}…` : t },
      { status: 502 }
    )
  }

  const logSource = resolved.kind === "local" ? "local" : resolved.logSource

  if (stream) {
    if (logUserId !== null) {
      logAiUsage({ userId: logUserId, source: logSource, model: resolved.model,
                   promptTokens: null, completionTokens: null, totalTokens: null })
    }
    return new Response(upstream.body, {
      headers: {
        "Content-Type":  "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection:       "keep-alive",
      },
    })
  }

  const json = (await upstream.json()) as {
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  }
  if (logUserId !== null) {
    const u = json.usage
    logAiUsage({
      userId:           logUserId,
      source:           logSource,
      model:            resolved.model,
      promptTokens:     u?.prompt_tokens     ?? null,
      completionTokens: u?.completion_tokens ?? null,
      totalTokens:      u?.total_tokens      ?? null,
    })
  }

  return NextResponse.json(json)
}
