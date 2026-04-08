import { assertCanUseAi } from "@/lib/ai-guard"
import { getUserAiSettings } from "@/lib/ai-settings"
import { decryptByok } from "@/lib/byok-crypto"
import { DEFAULT_OPENROUTER_MODEL } from "@/lib/openrouter-constants"

export { DEFAULT_OPENROUTER_MODEL }

export type ResolveOpenRouterOk = {
  ok: true
  apiKey: string
  source: "byok" | "platform"
  model: string
}

export type ResolveOpenRouterErr = {
  ok: false
  status: number
  message: string
  code?: string
}

export type ResolveOpenRouterResult = ResolveOpenRouterOk | ResolveOpenRouterErr

function resolvedModel(userModel: string | null, override?: string | null): string {
  const o = override?.trim()
  if (o) return o
  const u = userModel?.trim()
  if (u) return u
  const env = process.env.OPENROUTER_DEFAULT_MODEL?.trim()
  if (env) return env
  return DEFAULT_OPENROUTER_MODEL
}

/**
 * Server-only: which API key and model to use for OpenRouter for this user.
 */
export function resolveOpenRouterForUser(
  userId: number,
  modelOverride?: string | null
): ResolveOpenRouterResult {
  assertCanUseAi(userId)
  const settings = getUserAiSettings(userId)
  const model = resolvedModel(settings.openrouterModel, modelOverride)
  const platformKey = process.env.OPENROUTER_API_KEY?.trim() || ""

  let byokPlain: string | null = null
  if (settings.openrouterByokEncrypted) {
    byokPlain = decryptByok(settings.openrouterByokEncrypted)
    if (!byokPlain) {
      return {
        ok: false,
        status: 503,
        message:
          "Stored OpenRouter key could not be decrypted (WORKBENCH_BYOK_ENCRYPTION_KEY mismatch). Remove the old key and save a new one in Preferences → AI & models.",
        code: "BYOK_DECRYPT",
      }
    }
  }

  if (settings.aiKeySource === "byok_only") {
    if (!byokPlain) {
      return {
        ok: false,
        status: 403,
        message:
          "This account is set to use only your OpenRouter key. Add one in Preferences → AI & models (OpenRouter section).",
        code: "BYOK_REQUIRED",
      }
    }
    return { ok: true, apiKey: byokPlain, source: "byok", model }
  }

  if (settings.aiKeySource === "platform_only") {
    if (!platformKey) {
      return {
        ok: false,
        status: 503,
        message: "Platform OpenRouter is not configured (OPENROUTER_API_KEY).",
        code: "PLATFORM_KEY_MISSING",
      }
    }
    return { ok: true, apiKey: platformKey, source: "platform", model }
  }

  // auto
  if (byokPlain) {
    return { ok: true, apiKey: byokPlain, source: "byok", model }
  }
  if (!settings.aiAllowPlatform) {
    return {
      ok: false,
      status: 403,
      message:
        "Platform AI billing is disabled for your account. Add your OpenRouter key or turn on “Allow platform billing” in Preferences → AI & models.",
      code: "PLATFORM_DISABLED",
    }
  }
  if (!platformKey) {
    return {
      ok: false,
      status: 503,
      message:
        "No OpenRouter key available. Add your key in Preferences → AI & models, or ask the operator to set OPENROUTER_API_KEY on the server.",
      code: "NO_KEY",
    }
  }
  return { ok: true, apiKey: platformKey, source: "platform", model }
}
