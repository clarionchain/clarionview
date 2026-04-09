import { getUserAiSettings } from "@/lib/ai-settings"
import { decryptByok } from "@/lib/byok-crypto"

export const ROUTSTR_BASE = "https://api.routstr.com/v1"
export const ROUTSTR_DEFAULT_MODEL = "meta-llama/llama-3.1-8b-instruct"

type ResolvedRoutstr =
  | { ok: true; apiKey: string; model: string; source: "byok" | "platform" }
  | { ok: false; status: number; message: string; code: string }

export function resolveRoutstrForUser(userId: number, modelOverride: string | null): ResolvedRoutstr {
  const s = getUserAiSettings(userId)

  // Prefer user's own BYOK key
  if (s.routstrApiKeyEncrypted) {
    const key = decryptByok(s.routstrApiKeyEncrypted)
    if (!key) {
      return {
        ok: false,
        status: 503,
        message:
          "Stored Routstr key could not be decrypted (WORKBENCH_BYOK_ENCRYPTION_KEY mismatch). Remove the old key and save a new one in Preferences → AI & models.",
        code: "ROUTSTR_KEY_DECRYPT",
      }
    }
    const model = resolveModel(modelOverride, s.routstrModel)
    return { ok: true, apiKey: key, model, source: "byok" }
  }

  // Fall back to platform key
  const platformKey = process.env.ROUTSTR_API_KEY?.trim()
  if (platformKey) {
    const model = resolveModel(modelOverride, s.routstrModel)
    return { ok: true, apiKey: platformKey, model, source: "platform" }
  }

  return {
    ok: false,
    status: 503,
    message:
      "No Routstr API key configured. Add your key in Preferences → AI & models, or ask the operator to set ROUTSTR_API_KEY.",
    code: "ROUTSTR_NO_KEY",
  }
}

function resolveModel(override: string | null, saved: string | null): string {
  const m = override?.trim() || saved?.trim() || process.env.ROUTSTR_DEFAULT_MODEL?.trim() || ROUTSTR_DEFAULT_MODEL
  return m.slice(0, 256)
}
