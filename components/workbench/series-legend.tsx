"use client"

import { useMemo } from "react"
import { X, Eye, EyeOff, Plus, Loader2, Variable, Pencil, Check } from "lucide-react"
import {
  normalizePaneIndex,
  type SeriesConfig,
  layoutPaneSlotCount,
  maxPaneIndexUsed,
  MAX_LAYOUT_PANES,
} from "@/lib/workbench-types"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SeriesColorPicker } from "@/components/workbench/series-color-picker"

interface SeriesLegendProps {
  configs: SeriesConfig[]
  loading: Set<string>
  onUpdate: (id: string, patch: Partial<SeriesConfig>) => void
  onRemove: (id: string) => void
  onOpenMetricModal: () => void
  onOpenFormulaModal: () => void
  onEditFormula: (config: SeriesConfig) => void
}

function PanePicker({
  config,
  configs,
  onUpdate,
}: {
  config: SeriesConfig
  configs: SeriesConfig[]
  onUpdate: (id: string, patch: Partial<SeriesConfig>) => void
}) {
  const slots = layoutPaneSlotCount(configs)
  const maxIdx = maxPaneIndexUsed(configs)
  const current = normalizePaneIndex(config.paneIndex ?? 0)
  const canAddPane = maxIdx + 1 < MAX_LAYOUT_PANES

  const paneIndices = useMemo(() => Array.from({ length: slots }, (_, i) => i), [slots])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="px-1.5 py-1 text-[9px] font-medium border-l border-border/20 text-muted-foreground/50 hover:text-foreground hover:bg-accent/30 transition-colors tabular-nums outline-none focus-visible:ring-1 focus-visible:ring-ring/50 data-[state=open]:bg-accent/40 data-[state=open]:text-foreground"
          title="Choose chart pane"
        >
          P{current + 1}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" sideOffset={6} className="min-w-[9.5rem]">
        {paneIndices.map((i) => (
          <DropdownMenuItem
            key={i}
            className="text-xs py-1.5 gap-2"
            onClick={() => onUpdate(config.id, { paneIndex: i })}
          >
            <Check
              className={cn("h-3.5 w-3.5 shrink-0", current === i ? "text-foreground" : "text-transparent")}
              aria-hidden
            />
            Pane {i + 1}
          </DropdownMenuItem>
        ))}
        {canAddPane && (
          <>
            <DropdownMenuSeparator className="bg-border/40" />
            <DropdownMenuItem
              className="text-xs py-1.5 gap-2 text-muted-foreground focus:text-foreground"
              onClick={() => onUpdate(config.id, { paneIndex: maxIdx + 1 })}
            >
              <Plus className="h-3.5 w-3.5 shrink-0" />
              New pane
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function SeriesLegend({
  configs,
  loading,
  onUpdate,
  onRemove,
  onOpenMetricModal,
  onOpenFormulaModal,
  onEditFormula,
}: SeriesLegendProps) {
  return (
    <div className="shrink-0 border-t border-border/20 bg-card/30 px-3 py-2 overflow-x-auto">
      <div className="flex flex-wrap gap-1.5 items-center">
        {configs.map((config) => (
          <div
            key={config.id}
            className="flex items-center rounded-md border border-border/30 bg-background/30 overflow-hidden"
          >
            <SeriesColorPicker
              color={config.color}
              colorOpacity={config.colorOpacity ?? 1}
              lineStyle={config.lineStyle ?? "solid"}
              seriesType={config.type}
              onChange={(patch) => onUpdate(config.id, patch)}
            />

            {config.isFormula && (
              <button
                type="button"
                onClick={() => onEditFormula(config)}
                className="flex items-center gap-0.5 px-1 text-[9px] font-mono font-bold text-primary/50 hover:text-primary/80 transition-colors"
                title="Edit formula"
              >
                fx
                <Pencil className="h-2 w-2" />
              </button>
            )}

            <span className="px-1.5 py-1 text-xs text-foreground max-w-[140px] truncate">
              {config.displayName}
            </span>

            {loading.has(config.seriesName) && (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/50 mr-1" />
            )}

            <button
              type="button"
              onClick={() => onUpdate(config.id, { visible: !config.visible })}
              className={cn(
                "p-1 transition-colors",
                config.visible ? "text-muted-foreground/50 hover:text-muted-foreground" : "text-muted-foreground/20 hover:text-muted-foreground/40"
              )}
              title={config.visible ? "Hide" : "Show"}
            >
              {config.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            </button>

            <PanePicker config={config} configs={configs} onUpdate={onUpdate} />

            <div className="flex text-[9px] font-medium border-l border-border/20">
              <button
                type="button"
                onClick={() => onUpdate(config.id, { priceScaleId: "left" })}
                className={cn(
                  "px-1.5 py-1 transition-colors",
                  config.priceScaleId === "left"
                    ? "bg-accent/50 text-foreground"
                    : "text-muted-foreground/30 hover:text-muted-foreground/60"
                )}
                title="Left Y-axis"
              >
                L
              </button>
              <button
                type="button"
                onClick={() => onUpdate(config.id, { priceScaleId: "right" })}
                className={cn(
                  "px-1.5 py-1 transition-colors border-l border-border/20",
                  config.priceScaleId === "right"
                    ? "bg-accent/50 text-foreground"
                    : "text-muted-foreground/30 hover:text-muted-foreground/60"
                )}
              >
                R
              </button>
            </div>

            <button
              type="button"
              onClick={() => onRemove(config.id)}
              className="p-1 text-muted-foreground/20 hover:text-destructive/70 transition-colors border-l border-border/20"
              title="Remove"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={onOpenMetricModal}
          className="flex items-center gap-1 px-2.5 py-1 text-xs text-muted-foreground/40 hover:text-muted-foreground/70 hover:bg-accent/20 rounded-md border border-dashed border-border/25 transition-colors"
        >
          <Plus className="h-3 w-3" />
          Add metric
        </button>

        <button
          type="button"
          onClick={onOpenFormulaModal}
          className="flex items-center gap-1 px-2.5 py-1 text-xs text-muted-foreground/40 hover:text-muted-foreground/70 hover:bg-accent/20 rounded-md border border-dashed border-border/25 transition-colors"
        >
          <Variable className="h-3 w-3" />
          Add formula
        </button>
      </div>
    </div>
  )
}
