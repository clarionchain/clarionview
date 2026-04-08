"use client"

import React, { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from "react"
import {
  createChart,
  LineSeries,
  AreaSeries,
  HistogramSeries,
  ColorType,
  PriceScaleMode,
  CrosshairMode,
  LineStyle,
} from "lightweight-charts"
import type { IChartApi, Time, MouseEventParams } from "lightweight-charts"
import { normalizePaneIndex, type ActiveSeries, type CrosshairValues } from "@/lib/workbench-types"
import { areaColorsFromHex, seriesStrokeRgba } from "@/lib/series-visual"

function seriesOpacity(s: ActiveSeries): number {
  return typeof s.colorOpacity === "number" && Number.isFinite(s.colorOpacity)
    ? Math.min(1, Math.max(0, s.colorOpacity))
    : 1
}

function chartLineStyle(s: ActiveSeries): LineStyle {
  return s.lineStyle === "dotted" ? LineStyle.Dotted : LineStyle.Solid
}

export type TVChartHandle = {
  /** Visible bar time range (sortable date strings). */
  getVisibleTimeRange: () => { from: string; to: string } | null
}

interface TVChartProps {
  series: ActiveSeries[]
  paneScales: Record<number, "log" | "linear">
  onTogglePaneScale: (paneIndex: number) => void
  onCrosshairMove?: (data: CrosshairValues | null) => void
}

/** Same hex as `--workbench-shell` (sidebar / assistant / chart). */
function chartBackgroundColorFromTheme(): string {
  if (typeof window === "undefined") return "#0a0e14"
  const shell = getComputedStyle(document.documentElement).getPropertyValue("--workbench-shell").trim()
  if (shell) return shell
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--background").trim()
  if (!raw) return "#0a0e14"
  const parts = raw.split(/\s+/).filter(Boolean)
  if (parts.length < 3) return "#0a0e14"
  return `hsl(${parts.slice(0, 3).join(" ")})`
}

function timeToSortableString(t: Time): string {
  if (typeof t === "string") return t
  if (typeof t === "number") {
    return new Date(t * 1000).toISOString().slice(0, 10)
  }
  const b = t as { year: number; month: number; day: number }
  return `${b.year}-${String(b.month).padStart(2, "0")}-${String(b.day).padStart(2, "0")}`
}

type AnySeriesApi = {
  setData: (data: { time: Time; value: number }[]) => void
  applyOptions: (opts: Record<string, unknown>) => void
  moveToPane: (paneIndex: number) => void
}

const TVChart = forwardRef<TVChartHandle, TVChartProps>(function TVChart(
  { series, paneScales, onTogglePaneScale, onCrosshairMove },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesApiMap = useRef(new Map<string, AnySeriesApi>())
  const seriesPaneMap = useRef(new Map<string, number>())
  const prevSeriesRef = useRef<ActiveSeries[]>([])
  const onCrosshairMoveRef = useRef(onCrosshairMove)
  onCrosshairMoveRef.current = onCrosshairMove

  useImperativeHandle(
    ref,
    () => ({
      getVisibleTimeRange() {
        const chart = chartRef.current
        if (!chart) return null
        try {
          const vr = chart.timeScale().getVisibleRange()
          if (!vr) return null
          return { from: timeToSortableString(vr.from), to: timeToSortableString(vr.to) }
        } catch {
          return null
        }
      },
    }),
    []
  )

  const [panePositions, setPanePositions] = useState<{ top: number; height: number }[]>([])

  const updatePanePositions = useCallback(() => {
    const chart = chartRef.current
    if (!chart) return
    try {
      const panes = chart.panes()
      let top = 0
      const positions = panes.map((pane) => {
        const h = pane.getHeight()
        const pos = { top, height: h }
        top += h + 1
        return pos
      })
      setPanePositions(positions)
    } catch { /* pane API not available */ }
  }, [])

  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: chartBackgroundColorFromTheme() },
        textColor: "#6b7280",
        fontFamily: "'Inter', sans-serif",
        fontSize: 11,
        panes: {
          separatorColor: "rgba(255,255,255,0.06)",
          separatorHoverColor: "rgba(255,255,255,0.15)",
          enableResize: true,
        },
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.03)" },
        horzLines: { color: "rgba(255,255,255,0.03)" },
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.06)",
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      leftPriceScale: {
        visible: false,
        borderColor: "rgba(255,255,255,0.06)",
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.06)",
        timeVisible: false,
        rightOffset: 5,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "rgba(255,255,255,0.12)",
          width: 1,
          style: 2,
          labelBackgroundColor: "#1f2937",
        },
        horzLine: {
          color: "rgba(255,255,255,0.12)",
          width: 1,
          style: 2,
          labelBackgroundColor: "#1f2937",
        },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    })

    chartRef.current = chart

    chart.subscribeCrosshairMove((param: MouseEventParams<Time>) => {
      if (!param.time || !param.seriesData) {
        onCrosshairMoveRef.current?.(null)
        return
      }

      const entries: Record<string, number | null> = {}
      for (const [id, api] of seriesApiMap.current) {
        const d = param.seriesData.get(api as unknown as Parameters<typeof param.seriesData.get>[0])
        if (d && "value" in d) {
          entries[id] = (d as { value: number }).value
        } else {
          entries[id] = null
        }
      }

      let timeStr: string
      if (typeof param.time === "string") {
        timeStr = param.time
      } else if (typeof param.time === "number") {
        timeStr = new Date(param.time * 1000).toISOString().slice(0, 10)
      } else {
        const t = param.time as { year: number; month: number; day: number }
        timeStr = `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`
      }

      onCrosshairMoveRef.current?.({ time: timeStr, entries })
    })

    const containerEl = containerRef.current
    const observer = new ResizeObserver((resizeEntries) => {
      for (const entry of resizeEntries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) {
          chart.applyOptions({ width, height })
        }
      }
      updatePanePositions()
    })
    observer.observe(containerEl)

    const apiMap = seriesApiMap.current
    const paneMap = seriesPaneMap.current

    const positionInterval = setInterval(updatePanePositions, 200)

    return () => {
      clearInterval(positionInterval)
      observer.disconnect()
      chart.remove()
      chartRef.current = null
      apiMap.clear()
      paneMap.clear()
      prevSeriesRef.current = []
    }
  }, [updatePanePositions])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    const prevMap = new Map(prevSeriesRef.current.map((s) => [s.id, s]))
    const newMap = new Map(series.map((s) => [s.id, s]))

    for (const [id] of prevMap) {
      if (!newMap.has(id)) {
        const api = seriesApiMap.current.get(id)
        if (api) {
          chart.removeSeries(api as unknown as Parameters<typeof chart.removeSeries>[0])
          seriesApiMap.current.delete(id)
          seriesPaneMap.current.delete(id)
        }
      }
    }

    for (const [id, s] of newMap) {
      if (!seriesApiMap.current.has(id) && s.data.length > 0) {
        const pane = normalizePaneIndex(s.paneIndex ?? 0)
        const api = createSeriesOnChart(chart, s, pane)
        api.setData(s.data.map((d) => ({ time: d.time as Time, value: d.value })))
        seriesApiMap.current.set(id, api)
        seriesPaneMap.current.set(id, pane)
      }
    }

    for (const [id, s] of newMap) {
      const prev = prevMap.get(id)
      const api = seriesApiMap.current.get(id)
      if (!api || !prev) continue

      const newPane = normalizePaneIndex(s.paneIndex ?? 0)
      const currentPane = seriesPaneMap.current.get(id) ?? 0
      if (newPane !== currentPane) {
        api.moveToPane(newPane)
        seriesPaneMap.current.set(id, newPane)
      }

      const op = seriesOpacity(s)
      const prevOp = seriesOpacity(prev)
      const lineStyleChanged = chartLineStyle(s) !== chartLineStyle(prev)
      if (
        s.color !== prev.color ||
        op !== prevOp ||
        lineStyleChanged ||
        s.visible !== prev.visible ||
        s.priceScaleId !== prev.priceScaleId
      ) {
        if (s.type === "area") {
          const ac = areaColorsFromHex(s.color, op)
          api.applyOptions({
            ...ac,
            lineStyle: chartLineStyle(s),
            lineWidth: 1,
            visible: s.visible,
            priceScaleId: s.priceScaleId,
          })
        } else if (s.type === "histogram") {
          api.applyOptions({
            color: seriesStrokeRgba(s.color, op),
            visible: s.visible,
            priceScaleId: s.priceScaleId,
          })
        } else {
          api.applyOptions({
            color: seriesStrokeRgba(s.color, op),
            lineStyle: chartLineStyle(s),
            lineWidth: 1,
            visible: s.visible,
            priceScaleId: s.priceScaleId,
          })
        }
      }

      if (s.data !== prev.data && s.data.length > 0) {
        api.setData(s.data.map((d) => ({ time: d.time as Time, value: d.value })))
      }
    }

    const hasLeft = series.some((s) => s.priceScaleId === "left" && s.visible)
    chart.applyOptions({ leftPriceScale: { visible: hasLeft } })

    const hadSeriesOnChart = prevMap.size > 0 && [...prevMap.values()].some((s) => s.data.length > 0)
    const hasSeriesOnChart = series.some((s) => s.data.length > 0)
    prevSeriesRef.current = [...series]

    if (!hadSeriesOnChart && hasSeriesOnChart) {
      requestAnimationFrame(() => {
        chart.timeScale().fitContent()
      })
    }

    setTimeout(updatePanePositions, 50)
  }, [series, updatePanePositions])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    try {
      const panes = chart.panes()
      for (let i = 0; i < panes.length; i++) {
        const scaleMode = paneScales[i] === "linear" ? PriceScaleMode.Normal : PriceScaleMode.Logarithmic
        const pane = panes[i]
        const paneSeries = pane.getSeries()

        for (const s of paneSeries) {
          const seriesObj = s as unknown as { priceScale: () => { applyOptions: (o: Record<string, unknown>) => void } }
          try {
            seriesObj.priceScale().applyOptions({ mode: scaleMode })
          } catch { /* ignore */ }
        }
      }
    } catch {
      const mode = paneScales[0] === "linear" ? PriceScaleMode.Normal : PriceScaleMode.Logarithmic
      chart.applyOptions({
        rightPriceScale: { mode },
        leftPriceScale: { mode },
      })
    }
  }, [paneScales])

  return (
    <div ref={containerRef} className="w-full h-full relative">
      {panePositions.map((pos, i) => (
        <button
          key={i}
          onClick={() => onTogglePaneScale(i)}
          className="absolute z-10 px-1.5 py-0.5 text-[10px] font-medium rounded bg-card/70 text-muted-foreground/40 hover:text-foreground hover:bg-card transition-colors cursor-pointer"
          style={{ top: pos.top + 4, right: 80 }}
          title={`Click to switch to ${paneScales[i] === "linear" ? "Log" : "Linear"}`}
        >
          {(paneScales[i] ?? "linear") === "log" ? "Log" : "Lin"}
        </button>
      ))}
    </div>
  )
})

export default TVChart

function createSeriesOnChart(chart: IChartApi, s: ActiveSeries, paneIndex: number): AnySeriesApi {
  const op = seriesOpacity(s)
  const ls = chartLineStyle(s)
  switch (s.type) {
    case "area": {
      const ac = areaColorsFromHex(s.color, op)
      return chart.addSeries(AreaSeries, {
        ...ac,
        lineWidth: 1,
        lineStyle: ls,
        priceScaleId: s.priceScaleId,
        visible: s.visible,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 4,
      }, paneIndex) as unknown as AnySeriesApi
    }
    case "histogram":
      return chart.addSeries(HistogramSeries, {
        color: seriesStrokeRgba(s.color, op),
        priceScaleId: s.priceScaleId,
        visible: s.visible,
      }, paneIndex) as unknown as AnySeriesApi
    default:
      return chart.addSeries(LineSeries, {
        color: seriesStrokeRgba(s.color, op),
        lineWidth: 1,
        lineStyle: ls,
        priceScaleId: s.priceScaleId,
        visible: s.visible,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 4,
        lastValueVisible: true,
        priceLineVisible: false,
      }, paneIndex) as unknown as AnySeriesApi
  }
}
