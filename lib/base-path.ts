/** Subpath when deployed behind nginx (e.g. /workbench). Empty for local root dev. */
export const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ""

export function withBase(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`
  if (!basePath) return p
  return `${basePath}${p}`
}
