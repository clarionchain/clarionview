import { NextResponse } from "next/server"
import { requireUser } from "@/lib/api-auth"
import { logAiUsage } from "@/lib/ai-usage-log"
import { resolveChatTarget } from "@/lib/chat-target-resolve"

const ALLOWED_ROLES = new Set(["system", "user", "assistant", "tool"])
const MAX_CHART_CONTEXT_CHARS = 48_000
const MAX_MESSAGES = 80

type ChatMessage = { role: string; content: string }

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
    const role = (m as { role?: unknown }).role
    const content = (m as { content?: unknown }).content
    if (typeof role !== "string" || typeof content !== "string") return null
    if (!ALLOWED_ROLES.has(role)) return null
    if (content.length > 200_000) return null
    out.push({ role, content })
  }
  return out
}

export async function POST(req: Request) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  let body: { messages?: unknown; model?: unknown; stream?: unknown; chartContext?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const baseMessages = validateMessages(body.messages)
  if (!baseMessages) {
    return NextResponse.json(
      {
        error: `Invalid messages: need 1–${MAX_MESSAGES} items with role (system|user|assistant|tool) and string content`,
      },
      { status: 400 }
    )
  }

  const messages = mergeChartContext(baseMessages, body.chartContext)
  if (!messages) {
    return NextResponse.json({ error: "Invalid chartContext (expected string or omit)" }, { status: 400 })
  }
  if (messages.length > MAX_MESSAGES) {
    return NextResponse.json(
      { error: `Too many messages after merging chart context (max ${MAX_MESSAGES})` },
      { status: 400 }
    )
  }

  const stream = body.stream === true
  const modelOverride = typeof body.model === "string" ? body.model : null

  const resolved = resolveChatTarget(auth.userId, modelOverride)
  if (!resolved.ok) {
    return NextResponse.json(
      { error: resolved.message, code: resolved.code },
      { status: resolved.status }
    )
  }

  const upstream = await fetch(resolved.url, {
    method: "POST",
    headers: resolved.headers,
    body: JSON.stringify({
      model: resolved.model,
      messages,
      stream,
    }),
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
    } catch {
      /* keep default */
    }
    return NextResponse.json(
      { error: errMsg, detail: t.length > 2000 ? `${t.slice(0, 2000)}…` : t },
      { status: 502 }
    )
  }

  const logSource = resolved.kind === "local" ? "local" : resolved.logSource

  if (stream) {
    logAiUsage({
      userId: auth.userId,
      source: logSource,
      model: resolved.model,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
    })
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    })
  }

  const json = (await upstream.json()) as {
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  }
  const u = json.usage
  logAiUsage({
    userId: auth.userId,
    source: logSource,
    model: resolved.model,
    promptTokens: u?.prompt_tokens ?? null,
    completionTokens: u?.completion_tokens ?? null,
    totalTokens: u?.total_tokens ?? null,
  })

  return NextResponse.json(json)
}
