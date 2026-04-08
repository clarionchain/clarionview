import { getDb } from "@/lib/db"

export function logAiUsage(params: {
  userId: number
  source: "byok" | "platform" | "local"
  model: string
  promptTokens?: number | null
  completionTokens?: number | null
  totalTokens?: number | null
}): void {
  const db = getDb()
  db.prepare(
    `INSERT INTO ai_usage_log (user_id, source, model, prompt_tokens, completion_tokens, total_tokens)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    params.userId,
    params.source,
    params.model,
    params.promptTokens ?? null,
    params.completionTokens ?? null,
    params.totalTokens ?? null
  )
}
