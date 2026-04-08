"use client"

import { useMemo, useState } from "react"
import { PALETTE_COLUMNS } from "@/lib/grafana-palette"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { seriesPreviewCssColor } from "@/lib/series-visual"

/** `#rgb` → `#rrggbb` for `<input type="color">` */
export function normalizeHexForColorInput(hex: string): string {
  const s = hex.trim()
  if (/^#[0-9A-Fa-f]{6}$/i.test(s)) return s.toLowerCase()
  if (/^#[0-9A-Fa-f]{3}$/i.test(s)) {
    const r = s[1]
    const g = s[2]
    const b = s[3]
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  return "#888888"
}

type SeriesType = "line" | "area" | "histogram"

interface SeriesStylePickerProps {
  color: string
  colorOpacity: number
  lineStyle: "solid" | "dotted"
  seriesType: SeriesType
  onChange: (patch: Partial<{ color: string; colorOpacity: number; lineStyle: "solid" | "dotted" }>) => void
}

export function SeriesColorPicker({
  color,
  colorOpacity,
  lineStyle,
  seriesType,
  onChange,
}: SeriesStylePickerProps) {
  const safeValue = useMemo(() => normalizeHexForColorInput(color), [color])
  const [open, setOpen] = useState(false)
  const preview = seriesPreviewCssColor(color, colorOpacity)
  const opacityPct = Math.round(colorOpacity * 100)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center px-2 py-1 cursor-pointer hover:bg-accent/20 transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring/50 rounded-sm"
          title="Color & line style"
        >
          <span
            className="block h-2.5 w-2.5 rounded-full ring-1 ring-white/10"
            style={{ backgroundColor: preview }}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={6}
        className="min-w-[240px] border-border/60 bg-popover p-2"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex gap-1 justify-center">
          {PALETTE_COLUMNS.map((column, ci) => (
            <div key={ci} className="flex flex-col gap-1">
              {column.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  title={hex}
                  className={cn(
                    "h-4 w-5 rounded-sm border border-border/40 hover:scale-110 hover:z-10 transition-transform shadow-sm",
                    safeValue.toLowerCase() === hex.toLowerCase() &&
                      "ring-2 ring-white/50 ring-offset-1 ring-offset-background"
                  )}
                  style={{ backgroundColor: hex }}
                  onClick={() => {
                    onChange({ color: hex })
                    setOpen(false)
                  }}
                />
              ))}
            </div>
          ))}
        </div>

        <DropdownMenuSeparator className="bg-border/40 my-2" />

        <div className="space-y-2">
          <div
            className="flex items-center gap-2 rounded-md border border-border/40 bg-background/80 p-1.5"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <input
              type="color"
              value={safeValue}
              onChange={(e) => onChange({ color: e.target.value })}
              className="h-8 w-12 cursor-pointer rounded border-0 bg-transparent p-0 shrink-0"
              aria-label="Pick any color"
            />
            <span className="font-mono text-[10px] text-muted-foreground/70 truncate">{safeValue}</span>
          </div>

          <div className="pt-0.5">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-[10px] font-medium text-muted-foreground/80">Opacity</span>
              <span className="text-[10px] font-mono text-muted-foreground/60 tabular-nums">{opacityPct}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={opacityPct}
              onChange={(e) => onChange({ colorOpacity: Number(e.target.value) / 100 })}
              className="w-full h-1.5 accent-cyan-500 cursor-pointer"
              aria-label="Color opacity"
            />
          </div>

          {seriesType !== "histogram" ? (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground/80">Line</span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => onChange({ lineStyle: "solid" })}
                  className={cn(
                    "flex-1 rounded-md border px-2 py-1 text-[10px] font-medium transition-colors",
                    lineStyle === "solid"
                      ? "border-cyan-500/50 bg-cyan-500/15 text-foreground"
                      : "border-border/50 text-muted-foreground hover:bg-accent/30"
                  )}
                >
                  Solid
                </button>
                <button
                  type="button"
                  onClick={() => onChange({ lineStyle: "dotted" })}
                  className={cn(
                    "flex-1 rounded-md border px-2 py-1 text-[10px] font-medium transition-colors",
                    lineStyle === "dotted"
                      ? "border-cyan-500/50 bg-cyan-500/15 text-foreground"
                      : "border-border/50 text-muted-foreground hover:bg-accent/30"
                  )}
                >
                  Dotted
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
