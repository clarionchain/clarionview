import { assertCanUseAi } from "@/lib/ai-guard"
import { getUserAiSettings, type AiChatProvider } from "@/lib/ai-settings"
import { decryptByok } from "@/lib/byok-crypto"
import { normalizeOpenAiV1Base } from "@/lib/openai-base-url"
import { resolveOpenRouterForUser } from "@/lib/openrouter-resolve"
import { resolveRoutstrForUser, ROUTSTR_BASE } from "@/lib/routstr-resolve"
import type { GuestConfig } from "@/app/api/ai/chat/route"

export type ChatTargetOk =
  | {
      ok: true
      kind: "openrouter"
      url: string
      apiKey: string
      model: string
      headers: Record<string, string>
      logSource: "byok" | "platform"
    }
  | {
      ok: true
      kind: "local"
      url: string
      apiKey: string | null
      model: string
      headers: Record<string, string>
      logSource: "local"
    }
  | {
      ok: true
      kind: "routstr"
      url: string
      apiKey: string
      model: string
      headers: Record<string, string>
      logSource: "byok" | "platform"
    }

export type ChatTargetErr = { ok: false; status: number; message: string; code?: string }

export type ChatTarget = ChatTargetOk | ChatTargetErr

const OPENROUTER_CHAT = "https://openrouter.ai/api/v1/chat/completions"
const ROUTSTR_CHAT    = `${ROUTSTR_BASE}/chat/completions`

/**
 * Resolve chat target for an anonymous guest who provided their own config
 * from browser localStorage (no account required).
 */
export function resolveGuestTarget(config: GuestConfig, modelOverride: string | null): ChatTarget {
  const model = modelOverride?.trim() || config.model?.trim() || ""

  if (config.provider === "local") {
    const rawBase = config.baseUrl?.trim() || ""
    if (!rawBase) {
      return { ok: false, status: 503, message: "Local API URL not set. Add it in AI settings.", code: "LOCAL_URL_MISSING" }
    }
    const norm = normalizeOpenAiV1Base(rawBase)
    if (!norm.ok) return { ok: false, status: 400, message: norm.error, code: "LOCAL_URL_INVALID" }
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (config.apiKey?.trim()) headers.Authorization = `Bearer ${config.apiKey.trim()}`
    return {
      ok: true, kind: "local",
      url:    `${norm.base}/chat/completions`,
      apiKey: config.apiKey?.trim() || null,
      model:  model || process.env.LOCAL_DEFAULT_MODEL?.trim() || "llama3.2",
      headers, logSource: "local",
    }
  }

  if (config.provider === "routstr") {
    const key = config.apiKey?.trim()
    if (!key) return { ok: false, status: 503, message: "Routstr API key not set.", code: "ROUTSTR_KEY_MISSING" }
    return {
      ok: true, kind: "routstr",
      url:    ROUTSTR_CHAT,
      apiKey: key,
      model:  model || process.env.ROUTSTR_DEFAULT_MODEL?.trim() || "meta-llama/llama-3.1-8b-instruct",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      logSource: "byok",
    }
  }

  // OpenRouter (default)
  const key = config.apiKey?.trim()
  if (!key) return { ok: false, status: 503, message: "OpenRouter API key not set. Add it in AI settings.", code: "NO_KEY" }
  const headers: Record<string, string> = {
    Authorization:  `Bearer ${key}`,
    "Content-Type": "application/json",
    "X-Title":      "ClarionView",
  }
  return {
    ok: true, kind: "openrouter",
    url: OPENROUTER_CHAT, apiKey: key,
    model: model || process.env.OPENROUTER_DEFAULT_MODEL?.trim() || "anthropic/claude-3.5-haiku",
    headers, logSource: "byok",
  }
}

export function resolveChatTarget(userId: number, modelOverride: string | null): ChatTarget {
  assertCanUseAi(userId)
  const s = getUserAiSettings(userId)
  const provider: AiChatProvider = s.aiChatProvider

  if (provider === "local") {
    const rawBase = s.localOpenAiBaseUrl?.trim() || ""
    if (!rawBase) {
      return {
        ok: false,
        status: 503,
        message: "Local API URL missing. Open Preferences → AI & models and set your OpenAI-compatible base URL.",
        code: "LOCAL_URL_MISSING",
      }
    }
    const norm = normalizeOpenAiV1Base(rawBase)
    if (!norm.ok) {
      return { ok: false, status: 400, message: norm.error, code: "LOCAL_URL_INVALID" }
    }
    let apiKey: string | null = null
    if (s.localOpenAiApiKeyEncrypted) {
      apiKey = decryptByok(s.localOpenAiApiKeyEncrypted)
      if (!apiKey) {
        return {
          ok: false,
          status: 503,
          message:
            "Stored local API key could not be decrypted (WORKBENCH_BYOK_ENCRYPTION_KEY mismatch). Remove the old key and save a new one in Preferences → AI & models.",
          code: "LOCAL_KEY_DECRYPT",
        }
      }
    }
    const model =
      (modelOverride?.trim() || s.localModel?.trim() || process.env.LOCAL_DEFAULT_MODEL?.trim() || "llama3.2").slice(
        0,
        256
      )
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`
    }
    return {
      ok: true,
      kind: "local",
      url: `${norm.base}/chat/completions`,
      apiKey,
      model,
      headers,
      logSource: "local",
    }
  }

  if (provider === "routstr") {
    const rs = resolveRoutstrForUser(userId, modelOverride)
    if (!rs.ok) return { ok: false, status: rs.status, message: rs.message, code: rs.code }
    return {
      ok: true,
      kind: "routstr",
      url: `${ROUTSTR_BASE}/chat/completions`,
      apiKey: rs.apiKey,
      model: rs.model,
      headers: {
        Authorization: `Bearer ${rs.apiKey}`,
        "Content-Type": "application/json",
      },
      logSource: rs.source,
    }
  }

  const or = resolveOpenRouterForUser(userId, modelOverride)
  if (!or.ok) {
    return { ok: false, status: or.status, message: or.message, code: or.code }
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${or.apiKey}`,
    "Content-Type": "application/json",
  }
  const ref = process.env.OPENROUTER_HTTP_REFERER?.trim()
  if (ref) headers["HTTP-Referer"] = ref
  headers["X-Title"] = process.env.OPENROUTER_APP_TITLE?.trim() || "DC Workbench"
  return {
    ok: true,
    kind: "openrouter",
    url: OPENROUTER_CHAT,
    apiKey: or.apiKey,
    model: or.model,
    headers,
    logSource: or.source,
  }
}
