"use client"

import { useState, useEffect, useRef } from "react"
import { Search, ChevronRight, ChevronDown, Check, X, Loader2 } from "lucide-react"
import { METRIC_CATEGORIES, formatSeriesName } from "@/lib/workbench-types"
import { withBase } from "@/lib/base-path"
import { cn } from "@/lib/utils"

interface MetricModalProps {
  open: boolean
  activeNames: Set<string>
  loading: Set<string>
  onAdd: (seriesName: string, displayName: string) => void
  onClose: () => void
}

export function MetricModal({ open, activeNames, loading, onAdd, onClose }: MetricModalProps) {
  const [search, setSearch] = useState("")
  const [searchResults, setSearchResults] = useState<string[]>([])
  const [searching, setSearching] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setSearch("")
      setSearchResults([])
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  useEffect(() => {
    if (!search.trim()) {
      setSearchResults([])
      setSearching(false)
      return
    }

    setSearching(true)
    const timer = setTimeout(() => {
      fetch(withBase(`/api/workbench/search?q=${encodeURIComponent(search.trim())}`), {
        credentials: "include",
      })
        .then((r) => r.json())
        .then((data: string[]) => setSearchResults(data))
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false))
    }, 300)

    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open, onClose])

  const toggleCategory = (name: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const handleAdd = (seriesName: string, displayName: string) => {
    onAdd(seriesName, displayName)
  }

  const isActive = (name: string) => activeNames.has(name)
  const isLoading = (name: string) => loading.has(name)

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-lg bg-card border border-border/40 rounded-xl shadow-2xl shadow-black/40 flex flex-col max-h-[70vh] overflow-hidden animate-in fade-in-0 zoom-in-95 duration-150">
        {/* Search */}
        <div className="shrink-0 flex items-center gap-3 px-4 border-b border-border/30">
          <Search className="h-4 w-4 text-muted-foreground/40 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search 49k+ metrics..."
            className="flex-1 bg-transparent py-3.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
          />
          {search ? (
            <button
              onClick={() => setSearch("")}
              className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground/30 bg-background/50 border border-border/30 rounded">
              esc
            </kbd>
          )}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {search.trim() ? (
            <div className="py-1">
              {searching && (
                <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Searching...
                </div>
              )}
              {!searching && searchResults.length === 0 && search.trim() && (
                <div className="px-4 py-8 text-center text-xs text-muted-foreground/50">
                  No series found for &ldquo;{search}&rdquo;
                </div>
              )}
              {searchResults.map((name) => (
                <MetricRow
                  key={name}
                  name={name}
                  display={formatSeriesName(name)}
                  active={isActive(name)}
                  loading={isLoading(name)}
                  onAdd={() => handleAdd(name, formatSeriesName(name))}
                />
              ))}
            </div>
          ) : (
            <div className="py-1">
              {METRIC_CATEGORIES.map((cat) => (
                <div key={cat.name}>
                  <button
                    onClick={() => toggleCategory(cat.name)}
                    className="flex items-center gap-1.5 w-full px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 hover:text-muted-foreground/70 transition-colors sticky top-0 bg-card backdrop-blur-sm z-10"
                  >
                    {collapsed.has(cat.name) ? (
                      <ChevronRight className="h-3 w-3 shrink-0" />
                    ) : (
                      <ChevronDown className="h-3 w-3 shrink-0" />
                    )}
                    {cat.name}
                    <span className="ml-auto font-normal opacity-50">{cat.metrics.length}</span>
                  </button>
                  {!collapsed.has(cat.name) &&
                    cat.metrics.map((m) => (
                      <MetricRow
                        key={m.name}
                        name={m.name}
                        display={m.display}
                        active={isActive(m.name)}
                        loading={isLoading(m.name)}
                        onAdd={() => handleAdd(m.name, m.display)}
                      />
                    ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function MetricRow({
  name,
  display,
  active,
  loading,
  onAdd,
}: {
  name: string
  display: string
  active: boolean
  loading: boolean
  onAdd: () => void
}) {
  return (
    <button
      onClick={onAdd}
      disabled={active || loading}
      className={cn(
        "flex items-center gap-3 w-full px-4 py-2 text-left transition-colors group",
        active
          ? "opacity-40 cursor-default"
          : "hover:bg-accent/30 cursor-pointer"
      )}
    >
      <div className="flex-1 min-w-0">
        <span className="block text-sm text-foreground truncate">{display}</span>
        <span className="block text-[10px] text-muted-foreground/40 font-mono truncate">{name}</span>
      </div>
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground/50" />
      ) : active ? (
        <Check className="h-3.5 w-3.5 shrink-0 text-primary/60" />
      ) : (
        <span className="text-[10px] text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          + Add
        </span>
      )}
    </button>
  )
}
