"use client"

import { useState, useEffect, useRef } from "react"
import { X, Plus, Variable } from "lucide-react"
import { METRIC_CATEGORIES } from "@/lib/workbench-types"
import type { SeriesConfig } from "@/lib/workbench-types"
import { cn } from "@/lib/utils"

interface FormulaModalProps {
  open: boolean
  existingMetrics: string[]
  editingConfig?: SeriesConfig | null
  onAdd: (formula: string, variables: Record<string, string>, label: string) => void
  onEdit: (id: string, formula: string, variables: Record<string, string>, label: string) => void
  onClose: () => void
}

const ALL_CURATED_METRICS = METRIC_CATEGORIES.flatMap((cat) =>
  cat.metrics.map((m) => ({ name: m.name, display: m.display, category: cat.name }))
)

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

export function FormulaModal({ open, existingMetrics, editingConfig, onAdd, onEdit, onClose }: FormulaModalProps) {
  const [variables, setVariables] = useState<[string, string][]>([["A", ""], ["B", ""]])
  const [expression, setExpression] = useState("")
  const [label, setLabel] = useState("")
  const [varSearch, setVarSearch] = useState<Record<string, string>>({})
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null)
  const exprRef = useRef<HTMLInputElement>(null)

  const isEditing = !!editingConfig

  useEffect(() => {
    if (!open) return

    if (editingConfig?.isFormula && editingConfig.formula && editingConfig.variables) {
      const vars = Object.entries(editingConfig.variables).map(([k, v]) => [k, v] as [string, string])
      setVariables(vars.length > 0 ? vars : [["A", ""], ["B", ""]])
      setExpression(editingConfig.formula)
      setLabel(editingConfig.displayName)
    } else {
      setVariables([["A", ""], ["B", ""]])
      setExpression("")
      setLabel("")
    }
    setVarSearch({})
    setActiveDropdown(null)
  }, [open, editingConfig])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (activeDropdown) {
          setActiveDropdown(null)
        } else {
          onClose()
        }
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open, onClose, activeDropdown])

  const addVariable = () => {
    if (variables.length >= 8) return
    const nextLetter = LETTERS[variables.length] || `V${variables.length}`
    setVariables((prev) => [...prev, [nextLetter, ""]])
  }

  const removeVariable = (index: number) => {
    if (variables.length <= 1) return
    setVariables((prev) => prev.filter((_, i) => i !== index))
  }

  const setVariableMetric = (index: number, metric: string) => {
    setVariables((prev) => prev.map((v, i) => (i === index ? [v[0], metric] : v)))
    setActiveDropdown(null)
    setVarSearch({})
  }

  const handleSubmit = () => {
    if (!expression.trim()) return
    const vars = Object.fromEntries(variables.filter(([, v]) => v.trim()))
    if (Object.keys(vars).length === 0) return
    const finalLabel = label.trim() || expression.trim()

    if (isEditing && editingConfig) {
      onEdit(editingConfig.id, expression.trim(), vars, finalLabel)
    } else {
      onAdd(expression.trim(), vars, finalLabel)
    }
    onClose()
  }

  const mergedMetrics = (() => {
    const curated = new Set(ALL_CURATED_METRICS.map((m) => m.name))
    const extra = existingMetrics
      .filter((n) => !curated.has(n))
      .map((n) => ({ name: n, display: n, category: "On Chart" }))
    return [...extra, ...ALL_CURATED_METRICS]
  })()

  const getFilteredMetrics = (letter: string) => {
    const q = (varSearch[letter] || "").toLowerCase()
    if (!q) return mergedMetrics
    return mergedMetrics.filter(
      (m) => m.display.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
    )
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh] bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-lg bg-card border border-border/40 rounded-xl shadow-2xl shadow-black/40 flex flex-col max-h-[80vh] overflow-hidden animate-in fade-in-0 zoom-in-95 duration-150">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border/30">
          <div className="flex items-center gap-2">
            <Variable className="h-4 w-4 text-primary/60" />
            <span className="text-sm font-medium text-foreground">
              {isEditing ? "Edit Formula" : "Create Formula"}
            </span>
          </div>
          <button onClick={onClose} className="text-muted-foreground/40 hover:text-muted-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Variables */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-2">Variables</label>
            <div className="space-y-2">
              {variables.map(([letter, metric], i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold text-primary w-5 shrink-0 text-center">
                    {letter}
                  </span>
                  <span className="text-xs text-muted-foreground/40 shrink-0">=</span>

                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={activeDropdown === letter ? (varSearch[letter] ?? "") : metric}
                      onChange={(e) => {
                        setVarSearch((prev) => ({ ...prev, [letter]: e.target.value }))
                        setActiveDropdown(letter)
                      }}
                      onFocus={() => setActiveDropdown(letter)}
                      placeholder="Select or type metric..."
                      className="w-full bg-background/60 border border-border/40 rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-ring/50"
                    />

                    {activeDropdown === letter && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border/40 rounded-md shadow-xl z-20 max-h-48 overflow-y-auto">
                        {getFilteredMetrics(letter).map((m) => (
                          <button
                            key={m.name}
                            onClick={() => setVariableMetric(i, m.name)}
                            className={cn(
                              "flex items-center justify-between w-full px-3 py-1.5 text-left text-xs hover:bg-accent/30 transition-colors",
                              metric === m.name && "bg-accent/20"
                            )}
                          >
                            <span className="text-foreground truncate">{m.display}</span>
                            <span className="text-muted-foreground/30 font-mono ml-2 shrink-0 text-[10px]">{m.name}</span>
                          </button>
                        ))}
                        {getFilteredMetrics(letter).length === 0 && (
                          <button
                            onClick={() => setVariableMetric(i, varSearch[letter] || "")}
                            className="w-full px-3 py-2 text-left text-xs text-muted-foreground/50 hover:bg-accent/30"
                          >
                            Use &ldquo;{varSearch[letter]}&rdquo; as series name
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {variables.length > 1 && (
                    <button
                      onClick={() => removeVariable(i)}
                      className="p-1 text-muted-foreground/30 hover:text-muted-foreground transition-colors shrink-0"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}

              {variables.length < 8 && (
                <button
                  onClick={addVariable}
                  className="flex items-center gap-1 text-xs text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors mt-1"
                >
                  <Plus className="h-3 w-3" />
                  Add variable
                </button>
              )}
            </div>
          </div>

          {/* Expression */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Expression</label>
            <input
              ref={exprRef}
              type="text"
              value={expression}
              onChange={(e) => setExpression(e.target.value)}
              placeholder="e.g.  A / B   or   zscore(A, 730)"
              className="w-full bg-background/60 border border-border/40 rounded-md px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-ring/50"
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit() }}
            />
            <div className="mt-2 space-y-1 text-[10px] text-muted-foreground/40">
              <p>Math: + &minus; * / &ensp;&middot;&ensp; log() ln() sqrt() abs() exp() pow() min() max()</p>
              <p>
                Window: sma(A, 7) &ensp; ema(A, 21) &ensp; stdev(A, 30) &ensp; zscore(A, 730) &ensp; roc(A, 365) &ensp;
                delta(A, 1)
              </p>
            </div>
          </div>

          {/* Label */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Label</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={expression || "Formula label..."}
              className="w-full bg-background/60 border border-border/40 rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-ring/50"
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit() }}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-end gap-2 px-4 py-3 border-t border-border/30">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-muted-foreground/60 hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!expression.trim() || variables.every(([, v]) => !v.trim())}
            className="px-4 py-1.5 text-sm bg-primary/10 text-primary hover:bg-primary/20 rounded-md border border-primary/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {isEditing ? "Save Changes" : "Add Formula"}
          </button>
        </div>
      </div>
    </div>
  )
}
