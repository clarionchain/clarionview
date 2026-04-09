import { getDb } from "@/lib/db"

export type AiKeySourceMode = "auto" | "byok_only" | "platform_only"
/** Where chat completions are sent. */
export type AiChatProvider = "openrouter" | "local" | "routstr"

export type UserAiSettings = {
  openrouterByokEncrypted: string | null
  openrouterModel: string | null
  aiKeySource: AiKeySourceMode
  aiAllowPlatform: boolean
  aiChatProvider: AiChatProvider
  localOpenAiBaseUrl: string | null
  localOpenAiApiKeyEncrypted: string | null
  localModel: string | null
  routstrApiKeyEncrypted: string | null
  routstrModel: string | null
}

export function parseAiKeySource(raw: string | null | undefined): AiKeySourceMode {
  if (raw === "byok_only" || raw === "platform_only" || raw === "auto") {
    return raw
  }
  return "auto"
}

export function parseAiChatProvider(raw: string | null | undefined): AiChatProvider {
  if (raw === "local") return "local"
  if (raw === "routstr") return "routstr"
  return "openrouter"
}

export function getUserAiSettings(userId: number): UserAiSettings {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT openrouter_byok_encrypted, openrouter_model, ai_key_source, ai_allow_platform,
              ai_chat_provider, local_openai_base_url, local_openai_api_key_encrypted, local_model,
              routstr_api_key_encrypted, routstr_model
       FROM users WHERE id = ?`
    )
    .get(userId) as
    | {
        openrouter_byok_encrypted: string | null
        openrouter_model: string | null
        ai_key_source: string | null
        ai_allow_platform: number | null
        ai_chat_provider: string | null
        local_openai_base_url: string | null
        local_openai_api_key_encrypted: string | null
        local_model: string | null
        routstr_api_key_encrypted: string | null
        routstr_model: string | null
      }
    | undefined
  if (!row) {
    return {
      openrouterByokEncrypted: null,
      openrouterModel: null,
      aiKeySource: "auto",
      aiAllowPlatform: true,
      aiChatProvider: "openrouter",
      localOpenAiBaseUrl: null,
      localOpenAiApiKeyEncrypted: null,
      localModel: null,
      routstrApiKeyEncrypted: null,
      routstrModel: null,
    }
  }
  return {
    openrouterByokEncrypted: row.openrouter_byok_encrypted,
    openrouterModel: row.openrouter_model,
    aiKeySource: parseAiKeySource(row.ai_key_source),
    aiAllowPlatform: row.ai_allow_platform !== 0,
    aiChatProvider: parseAiChatProvider(row.ai_chat_provider),
    localOpenAiBaseUrl: row.local_openai_base_url,
    localOpenAiApiKeyEncrypted: row.local_openai_api_key_encrypted,
    localModel: row.local_model,
    routstrApiKeyEncrypted: row.routstr_api_key_encrypted,
    routstrModel: row.routstr_model,
  }
}

export function updateUserAiSettings(
  userId: number,
  next: {
    openrouterByokEncrypted: string | null
    openrouterModel: string | null
    aiKeySource: AiKeySourceMode
    aiAllowPlatform: boolean
    aiChatProvider: AiChatProvider
    localOpenAiBaseUrl: string | null
    localOpenAiApiKeyEncrypted: string | null
    localModel: string | null
    routstrApiKeyEncrypted: string | null
    routstrModel: string | null
  }
): void {
  const db = getDb()
  db.prepare(
    `UPDATE users SET
      openrouter_byok_encrypted = ?,
      openrouter_model = ?,
      ai_key_source = ?,
      ai_allow_platform = ?,
      ai_chat_provider = ?,
      local_openai_base_url = ?,
      local_openai_api_key_encrypted = ?,
      local_model = ?,
      routstr_api_key_encrypted = ?,
      routstr_model = ?
     WHERE id = ?`
  ).run(
    next.openrouterByokEncrypted,
    next.openrouterModel,
    next.aiKeySource,
    next.aiAllowPlatform ? 1 : 0,
    next.aiChatProvider,
    next.localOpenAiBaseUrl,
    next.localOpenAiApiKeyEncrypted,
    next.localModel,
    next.routstrApiKeyEncrypted,
    next.routstrModel,
    userId
  )
}
