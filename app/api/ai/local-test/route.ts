import { NextResponse } from "next/server"
import { requireUser } from "@/lib/api-auth"
import { getUserAiSettings } from "@/lib/ai-settings"
import { decryptByok } from "@/lib/byok-crypto"
import { normalizeOpenAiV1Base } from "@/lib/openai-base-url"

export async function GET() {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  const s = getUserAiSettings(auth.userId)

  if (s.aiChatProvider !== "local") {
    return NextResponse.json({ ok: false, error: "Provider is not set to Local" })
  }

  const rawBase = s.localOpenAiBaseUrl?.trim() || ""
  if (!rawBase) {
    return NextResponse.json({ ok: false, error: "No API base URL configured" })
  }

  const norm = normalizeOpenAiV1Base(rawBase)
  if (!norm.ok) {
    return NextResponse.json({ ok: false, error: norm.error, normalizedBase: null })
  }

  const headers: Record<string, string> = {}
  if (s.localOpenAiApiKeyEncrypted) {
    const k = decryptByok(s.localOpenAiApiKeyEncrypted)
    if (!k) {
      return NextResponse.json({ ok: false, error: "Stored API key could not be decrypted — remove it and re-enter", normalizedBase: norm.base })
    }
    headers.Authorization = `Bearer ${k}`
  }

  const chatUrl = `${norm.base}/chat/completions`
  const modelsUrl = `${norm.base}/models`

  // Try models first (cheap GET)
  let modelsStatus: number | null = null
  let modelsBody = ""
  try {
    const r = await fetch(modelsUrl, { headers, signal: AbortSignal.timeout(8_000) })
    modelsStatus = r.status
    modelsBody = await r.text().catch(() => "")
  } catch (e) {
    return NextResponse.json({
      ok: false,
      normalizedBase: norm.base,
      chatUrl,
      modelsUrl,
      error: `Connection failed: ${e instanceof Error ? e.message : String(e)}`,
    })
  }

  if (modelsStatus && modelsStatus >= 400) {
    return NextResponse.json({
      ok: false,
      normalizedBase: norm.base,
      chatUrl,
      modelsUrl,
      modelsStatus,
      error: `Server returned HTTP ${modelsStatus}`,
      detail: modelsBody.slice(0, 500),
    })
  }

  // Try to parse models
  let modelCount = 0
  try {
    const j = JSON.parse(modelsBody) as { data?: unknown[] }
    modelCount = Array.isArray(j.data) ? j.data.length : 0
  } catch { /* non-JSON is OK — chat might still work */ }

  return NextResponse.json({
    ok: true,
    normalizedBase: norm.base,
    chatUrl,
    modelsUrl,
    modelsStatus,
    modelCount,
    message: `Reached ${norm.base} (HTTP ${modelsStatus})${modelCount > 0 ? ` — ${modelCount} models` : ""}`,
  })
}
