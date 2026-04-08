import { NextResponse } from "next/server"
import { requireUser } from "@/lib/api-auth"
import { encryptByok } from "@/lib/byok-crypto"
import {
  getUserAiSettings,
  updateUserAiSettings,
  type AiChatProvider,
  type AiKeySourceMode,
} from "@/lib/ai-settings"
import { DEFAULT_OPENROUTER_MODEL } from "@/lib/openrouter-constants"

function isAiKeySourceMode(s: string): s is AiKeySourceMode {
  return s === "auto" || s === "byok_only" || s === "platform_only"
}

function isAiChatProvider(s: string): s is AiChatProvider {
  return s === "openrouter" || s === "local"
}

function jsonSettings(userId: number) {
  const s = getUserAiSettings(userId)
  const platformConfigured = Boolean(process.env.OPENROUTER_API_KEY?.trim())
  const envDefault = process.env.OPENROUTER_DEFAULT_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL
  const localDefault = process.env.LOCAL_DEFAULT_MODEL?.trim() || "llama3.2"
  return {
    model: s.openrouterModel,
    aiKeySource: s.aiKeySource,
    aiAllowPlatform: s.aiAllowPlatform,
    hasByok: Boolean(s.openrouterByokEncrypted),
    platformConfigured,
    defaultModelSuggestion: envDefault,
    aiChatProvider: s.aiChatProvider,
    localOpenAiBaseUrl: s.localOpenAiBaseUrl,
    localModel: s.localModel,
    hasLocalApiKey: Boolean(s.localOpenAiApiKeyEncrypted),
    defaultLocalModelSuggestion: localDefault,
  }
}

export async function GET() {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth
  return NextResponse.json(jsonSettings(auth.userId))
}

export async function PATCH(req: Request) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const cur = getUserAiSettings(auth.userId)

  let openrouterByokEncrypted: string | null = cur.openrouterByokEncrypted
  const keyAction = body.openrouterKeyAction
  if (keyAction === "clear") {
    openrouterByokEncrypted = null
  } else if (keyAction === "set") {
    const raw = body.openrouterApiKey
    if (typeof raw !== "string") {
      return NextResponse.json({ error: "openrouterApiKey must be a string when openrouterKeyAction is set" }, { status: 400 })
    }
    const trimmed = raw.trim()
    if (trimmed.length < 8) {
      return NextResponse.json({ error: "OpenRouter key looks too short" }, { status: 400 })
    }
    try {
      openrouterByokEncrypted = encryptByok(trimmed)
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Encryption failed"
      return NextResponse.json({ error: msg }, { status: 503 })
    }
  } else if (keyAction !== undefined && keyAction !== "keep") {
    return NextResponse.json(
      { error: "openrouterKeyAction must be keep, set, or clear" },
      { status: 400 }
    )
  }

  let localOpenAiApiKeyEncrypted: string | null = cur.localOpenAiApiKeyEncrypted
  const localKeyAction = body.localApiKeyAction
  if (localKeyAction === "clear") {
    localOpenAiApiKeyEncrypted = null
  } else if (localKeyAction === "set") {
    const raw = body.localApiKey
    if (typeof raw !== "string") {
      return NextResponse.json({ error: "localApiKey must be a string when localApiKeyAction is set" }, { status: 400 })
    }
    const trimmed = raw.trim()
    if (trimmed.length < 1) {
      return NextResponse.json({ error: "Local API key cannot be empty" }, { status: 400 })
    }
    try {
      localOpenAiApiKeyEncrypted = encryptByok(trimmed)
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Encryption failed"
      return NextResponse.json({ error: msg }, { status: 503 })
    }
  } else if (localKeyAction !== undefined && localKeyAction !== "keep") {
    return NextResponse.json(
      { error: "localApiKeyAction must be keep, set, or clear" },
      { status: 400 }
    )
  }

  let openrouterModel: string | null = cur.openrouterModel
  if ("model" in body) {
    const m = body.model
    if (m === null || m === "") {
      openrouterModel = null
    } else if (typeof m === "string") {
      const t = m.trim()
      openrouterModel = t.length > 0 ? t.slice(0, 256) : null
    } else {
      return NextResponse.json({ error: "model must be string or null" }, { status: 400 })
    }
  }

  let localModel: string | null = cur.localModel
  if ("localModel" in body) {
    const m = body.localModel
    if (m === null || m === "") {
      localModel = null
    } else if (typeof m === "string") {
      const t = m.trim()
      localModel = t.length > 0 ? t.slice(0, 256) : null
    } else {
      return NextResponse.json({ error: "localModel must be string or null" }, { status: 400 })
    }
  }

  let localOpenAiBaseUrl: string | null = cur.localOpenAiBaseUrl
  if ("localOpenAiBaseUrl" in body) {
    const u = body.localOpenAiBaseUrl
    if (u === null || u === "") {
      localOpenAiBaseUrl = null
    } else if (typeof u === "string") {
      const t = u.trim()
      localOpenAiBaseUrl = t.length > 0 ? t.slice(0, 2048) : null
    } else {
      return NextResponse.json({ error: "localOpenAiBaseUrl must be string or null" }, { status: 400 })
    }
  }

  let aiChatProvider = cur.aiChatProvider
  if ("aiChatProvider" in body) {
    const v = body.aiChatProvider
    if (typeof v !== "string" || !isAiChatProvider(v)) {
      return NextResponse.json({ error: "Invalid aiChatProvider" }, { status: 400 })
    }
    aiChatProvider = v
  }

  let aiKeySource = cur.aiKeySource
  if ("aiKeySource" in body) {
    const v = body.aiKeySource
    if (typeof v !== "string" || !isAiKeySourceMode(v)) {
      return NextResponse.json({ error: "Invalid aiKeySource" }, { status: 400 })
    }
    aiKeySource = v
  }

  let aiAllowPlatform = cur.aiAllowPlatform
  if ("aiAllowPlatform" in body) {
    if (typeof body.aiAllowPlatform !== "boolean") {
      return NextResponse.json({ error: "aiAllowPlatform must be boolean" }, { status: 400 })
    }
    aiAllowPlatform = body.aiAllowPlatform
  }

  updateUserAiSettings(auth.userId, {
    openrouterByokEncrypted,
    openrouterModel,
    aiKeySource,
    aiAllowPlatform,
    aiChatProvider,
    localOpenAiBaseUrl,
    localOpenAiApiKeyEncrypted,
    localModel,
  })

  return NextResponse.json({ ok: true, ...jsonSettings(auth.userId) })
}
