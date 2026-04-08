/** Normalize user input to an OpenAI-compatible API root ending in `/v1` (no trailing slash). */
export function normalizeOpenAiV1Base(
  raw: string
): { ok: true; base: string } | { ok: false; error: string } {
  const t = raw.trim()
  if (!t) return { ok: false, error: "URL is empty" }
  const withProto = /^https?:\/\//i.test(t) ? t : `http://${t}`
  let u: URL
  try {
    u = new URL(withProto)
  } catch {
    return { ok: false, error: "Invalid URL" }
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, error: "Only http:// and https:// are allowed" }
  }
  const blocked = new Set(["169.254.169.254", "metadata.google.internal", "metadata.goog"])
  if (blocked.has(u.hostname.toLowerCase())) {
    return { ok: false, error: "This host is not allowed" }
  }
  let path = u.pathname.replace(/\/$/, "") || ""
  if (!path.endsWith("/v1")) {
    path = `${path}/v1`.replace(/\/+/g, "/")
    if (!path.startsWith("/")) path = `/${path}`
  }
  const base = `${u.origin}${path}`
  return { ok: true, base }
}
