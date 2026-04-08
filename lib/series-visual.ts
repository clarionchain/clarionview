/** Parse #rgb or #rrggbb → {r,g,b} 0–255 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const s = hex.trim()
  if (/^#[0-9A-Fa-f]{6}$/i.test(s)) {
    return {
      r: parseInt(s.slice(1, 3), 16),
      g: parseInt(s.slice(3, 5), 16),
      b: parseInt(s.slice(5, 7), 16),
    }
  }
  if (/^#[0-9A-Fa-f]{3}$/i.test(s)) {
    const r = s[1]
    const g = s[2]
    const b = s[3]
    return {
      r: parseInt(r + r, 16),
      g: parseInt(g + g, 16),
      b: parseInt(b + b, 16),
    }
  }
  return null
}

export function rgbaFromHex(hex: string, alpha: number): string {
  const a = Math.min(1, Math.max(0, alpha))
  const rgb = hexToRgb(hex)
  if (!rgb) return `rgba(136,136,136,${a})`
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`
}

/** Line stroke / histogram column color */
export function seriesStrokeRgba(hex: string, opacity: number): string {
  return rgbaFromHex(hex, opacity)
}

/** Area series: line + gradient fill alphas scaled by user opacity */
export function areaColorsFromHex(hex: string, opacity: number) {
  const o = Math.min(1, Math.max(0, opacity))
  return {
    lineColor: rgbaFromHex(hex, o),
    topColor: rgbaFromHex(hex, o * 0.35),
    bottomColor: rgbaFromHex(hex, o * 0.06),
  }
}

/** CSS background for legend dot (matches stroke) */
export function seriesPreviewCssColor(hex: string, opacity: number): string {
  return seriesStrokeRgba(hex, opacity)
}
