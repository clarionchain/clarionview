import type { ActiveSeries, CrosshairValues, SeriesConfig } from "@/lib/workbench-types"
import { formatValue, normalizePaneIndex } from "@/lib/workbench-types"

export type VisibleTimeRange = { from: string; to: string }

function seriesInTimeWindow(
  data: { time: string; value: number }[],
  range: VisibleTimeRange | null,
  maxPoints: number
): { time: string; value: number }[] {
  let rows = data
  if (range && rows.length > 0) {
    const { from, to } = range
    rows = rows.filter((d) => d.time >= from && d.time <= to)
  }
  if (rows.length <= maxPoints) return rows
  return rows.slice(-maxPoints)
}

function statsFor(values: number[]): { min: number; max: number; last: number; mean: number } | null {
  const finite = values.filter((v) => Number.isFinite(v))
  if (finite.length === 0) return null
  let min = finite[0]!
  let max = finite[0]!
  let sum = 0
  for (const v of finite) {
    if (v < min) min = v
    if (v > max) max = v
    sum += v
  }
  return { min, max, last: finite[finite.length - 1]!, mean: sum / finite.length }
}

/**
 * Structured markdown for the LLM: workbook, viewport, series metadata, aggregates, crosshair snapshot.
 */
export function buildChartContextMarkdown(params: {
  workbookName: string
  configs: SeriesConfig[]
  activeSeries: ActiveSeries[]
  crosshair: CrosshairValues | null
  visibleRange: VisibleTimeRange | null
  paneScales: Record<number, "log" | "linear">
}): string {
  const lines: string[] = []
  lines.push(`### Workbook`)
  lines.push(`- **Name:** ${params.workbookName}`)
  lines.push("")

  lines.push(`### Chart viewport (visible time range)`)
  if (params.visibleRange) {
    lines.push(`- **From:** \`${params.visibleRange.from}\``)
    lines.push(`- **To:** \`${params.visibleRange.to}\``)
  } else {
    lines.push(`- _(unavailable — aggregates use the latest portion of each series)_`)
  }
  lines.push("")

  const paneBits = Object.entries(params.paneScales)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([i, mode]) => `pane ${i}: ${mode}`)
  if (paneBits.length > 0) {
    lines.push(`### Pane scales`)
    lines.push(paneBits.join(" · "))
    lines.push("")
  }

  lines.push(`### Series`)
  for (const s of params.activeSeries) {
    if (!s.visible) continue
    const pane = normalizePaneIndex(s.paneIndex ?? 0)
    const scale = params.paneScales[pane] ?? "linear"
    const windowed = seriesInTimeWindow(s.data, params.visibleRange, 400)
    const values = windowed.map((d) => d.value)
    const st = statsFor(values)

    lines.push(`#### ${s.displayName}`)
    lines.push(`- **id:** \`${s.id}\` · **metric / key:** \`${s.seriesName}\``)
    lines.push(`- **pane:** ${pane} · **scale:** ${scale} · **type:** ${s.type}`)
    if (s.isFormula && s.formula) {
      lines.push(`- **formula:** \`${s.formula}\``)
      if (s.variables && Object.keys(s.variables).length > 0) {
        lines.push(`- **variables:** ${JSON.stringify(s.variables)}`)
      }
    }
    if (windowed.length === 0) {
      lines.push(`- **data:** _(no points in window / still loading)_`)
    } else {
      lines.push(
        `- **points in window:** ${windowed.length} (capped for context; chart may have more)`
      )
      if (st) {
        lines.push(
          `- **min / max / mean / last:** ${formatValue(st.min)} / ${formatValue(st.max)} / ${formatValue(st.mean)} / ${formatValue(st.last)}`
        )
      }
      const head = windowed.slice(0, 3)
      const tail = windowed.slice(-3)
      lines.push(
        `- **sample (oldest in window):** ${head.map((d) => `\`${d.time}\`=${formatValue(d.value)}`).join(", ")}`
      )
      if (windowed.length > 6) {
        lines.push(
          `- **sample (newest in window):** ${tail.map((d) => `\`${d.time}\`=${formatValue(d.value)}`).join(", ")}`
        )
      }
    }
    lines.push("")
  }

  if (params.crosshair && params.configs.some((c) => c.visible)) {
    lines.push(`### Crosshair snapshot (user pointer)`)
    lines.push(`- **time:** \`${params.crosshair.time}\``)
    for (const c of params.configs) {
      if (!c.visible) continue
      const v = params.crosshair.entries[c.id]
      lines.push(`- **${c.displayName}:** ${v != null && Number.isFinite(v) ? formatValue(v) : "—"}`)
    }
    lines.push("")
  }

  lines.push(`_Context is generated from the current workbench view; it may omit very long histories._`)
  return lines.join("\n")
}
