import { NextResponse } from "next/server"
import { requireUser } from "@/lib/api-auth"
import { getUserAiSettings } from "@/lib/ai-settings"
import { decryptByok } from "@/lib/byok-crypto"
import { normalizeOpenAiV1Base } from "@/lib/openai-base-url"
import { resolveOpenRouterForUser } from "@/lib/openrouter-resolve"
import { resolveRoutstrForUser, ROUTSTR_BASE } from "@/lib/routstr-resolve"

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"

export type ListedModel = { id: string; name: string }

type CacheEntry = { expires: number; models: ListedModel[]; cacheKey: string }

let cache: CacheEntry | null = null
const TTL_MS = 10 * 60 * 1000

function parseModelsPayload(json: unknown): ListedModel[] {
  const j = json as { data?: { id: string; name?: string; canonical_slug?: string }[] }
  const rows = j.data ?? []
  return rows.map((m) => ({
    id: m.id,
    name: (m.name && m.name.trim()) || m.canonical_slug || m.id,
  }))
}

export async function GET() {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  const s = getUserAiSettings(auth.userId)
  const now = Date.now()

  if (s.aiChatProvider === "routstr") {
    const resolved = resolveRoutstrForUser(auth.userId, null)
    const cacheKey = `routstr:${auth.userId}:${resolved.ok ? resolved.source : "n"}`

    if (cache && cache.expires > now && cache.cacheKey === cacheKey) {
      return NextResponse.json({
        models: cache.models,
        cached: true,
        listSource: "auth",
        chatReady: resolved.ok,
        chatHint: resolved.ok ? undefined : resolved.message,
        chatCode: resolved.ok ? undefined : resolved.code,
        provider: "routstr",
      })
    }

    if (!resolved.ok) {
      return NextResponse.json({
        models: [] as ListedModel[],
        cached: false,
        listSource: "auth",
        chatReady: false,
        chatHint: resolved.message,
        chatCode: resolved.code,
        provider: "routstr",
      })
    }

    const upstream = await fetch(`${ROUTSTR_BASE}/models`, {
      headers: { Authorization: `Bearer ${resolved.apiKey}` },
    }).catch(() => null)

    if (!upstream || !upstream.ok) {
      // Return known good models as fallback if the catalog endpoint fails
      const fallback: ListedModel[] = [
        { id: "meta-llama/llama-3.1-8b-instruct", name: "Llama 3.1 8B Instruct" },
        { id: "meta-llama/llama-3.1-70b-instruct", name: "Llama 3.1 70B Instruct" },
        { id: "mistralai/mistral-7b-instruct", name: "Mistral 7B Instruct" },
        { id: "openai/gpt-4o", name: "GPT-4o" },
        { id: "openai/gpt-4o-mini", name: "GPT-4o Mini" },
        { id: "anthropic/claude-3-5-sonnet", name: "Claude 3.5 Sonnet" },
      ]
      return NextResponse.json({
        models: fallback,
        cached: false,
        listSource: "fallback",
        chatReady: true,
        provider: "routstr",
      })
    }

    const json = await upstream.json()
    const models = parseModelsPayload(json)
    cache = { expires: now + TTL_MS, models, cacheKey }
    return NextResponse.json({
      models,
      cached: false,
      listSource: "auth",
      chatReady: true,
      provider: "routstr",
    })
  }

  if (s.aiChatProvider === "local") {
    const rawBase = s.localOpenAiBaseUrl?.trim() || ""
    if (!rawBase) {
      return NextResponse.json({
        models: [] as ListedModel[],
        cached: false,
        listSource: "local",
        chatReady: false,
        chatHint: "Set a local OpenAI-compatible API base URL in Preferences → AI & models.",
        chatCode: "LOCAL_URL_MISSING",
        provider: "local",
      })
    }
    const norm = normalizeOpenAiV1Base(rawBase)
    if (!norm.ok) {
      return NextResponse.json({
        models: [] as ListedModel[],
        cached: false,
        listSource: "local",
        chatReady: false,
        chatHint: norm.error,
        chatCode: "LOCAL_URL_INVALID",
        provider: "local",
      })
    }

    const cacheKey = `local:${norm.base}`
    if (cache && cache.expires > now && cache.cacheKey === cacheKey) {
      return NextResponse.json({
        models: cache.models,
        cached: true,
        listSource: "local",
        chatReady: true,
        provider: "local",
      })
    }

    const headers: Record<string, string> = {}
    if (s.localOpenAiApiKeyEncrypted) {
      const k = decryptByok(s.localOpenAiApiKeyEncrypted)
      if (k) headers.Authorization = `Bearer ${k}`
    }

    const upstream = await fetch(`${norm.base}/models`, { headers })
    if (!upstream.ok) {
      const t = await upstream.text()
      return NextResponse.json(
        {
          error: "Could not list models from local server",
          detail: t.length > 800 ? `${t.slice(0, 800)}…` : t,
          models: [] as ListedModel[],
          chatReady: true,
          provider: "local",
        },
        { status: 502 }
      )
    }

    const json = await upstream.json()
    const models = parseModelsPayload(json)
    cache = { expires: now + TTL_MS, models, cacheKey }
    return NextResponse.json({
      models,
      cached: false,
      listSource: "local",
      chatReady: true,
      provider: "local",
    })
  }

  const resolved = resolveOpenRouterForUser(auth.userId, null)
  const cacheKey = `or:${auth.userId}:${resolved.ok ? "y" : "n"}`

  if (cache && cache.expires > now && cache.cacheKey === cacheKey) {
    return NextResponse.json({
      models: cache.models,
      cached: true,
      listSource: "auth",
      chatReady: resolved.ok,
      chatHint: resolved.ok ? undefined : resolved.message,
      chatCode: resolved.ok ? undefined : resolved.code,
      provider: "openrouter",
    })
  }

  async function fetchModels(bearer: string | null): Promise<Response> {
    const headers: Record<string, string> = {}
    if (bearer) headers.Authorization = `Bearer ${bearer}`
    return fetch(OPENROUTER_MODELS_URL, { headers })
  }

  let listSource: "auth" | "public" = "public"
  let upstream: Response

  if (resolved.ok) {
    upstream = await fetchModels(resolved.apiKey)
    if (upstream.ok) {
      listSource = "auth"
    } else {
      upstream = await fetchModels(null)
      listSource = "public"
    }
  } else {
    upstream = await fetchModels(null)
    listSource = "public"
  }

  if (!upstream.ok) {
    const t = await upstream.text()
    return NextResponse.json(
      {
        error: "Failed to fetch models from OpenRouter",
        detail: t.length > 800 ? `${t.slice(0, 800)}…` : t,
        models: [] as ListedModel[],
        chatReady: resolved.ok,
        chatHint: resolved.ok ? undefined : resolved.message,
        chatCode: resolved.ok ? undefined : resolved.code,
        provider: "openrouter",
      },
      { status: 502 }
    )
  }

  const json = await upstream.json()
  const models = parseModelsPayload(json)
  cache = { expires: now + TTL_MS, models, cacheKey }
  return NextResponse.json({
    models,
    cached: false,
    listSource,
    chatReady: resolved.ok,
    chatHint: resolved.ok ? undefined : resolved.message,
    chatCode: resolved.ok ? undefined : resolved.code,
    provider: "openrouter",
  })
}
