"use client"

import { useState, useEffect } from "react"
import { Search, ChevronRight, ChevronDown, Check, X, Loader2 } from "lucide-react"
import { METRIC_CATEGORIES, formatSeriesName } from "@/lib/workbench-types"
import { MARKET_CATEGORIES } from "@/lib/market-categories"
import { withBase } from "@/lib/base-path"
import { cn } from "@/lib/utils"

interface MetricPanelProps {
  activeNames: Set<string>
  loading: Set<string>
  onAdd: (seriesName: string, displayName: string) => void
  onClose: () => void
}

interface SearchResult {
  name: string
  display?: string
}

const SOURCE_BADGE: Record<string, string> = {
  "yf:":   "Equity",
  "fred:": "FRED",
}

function getSourceBadge(name: string): string | null {
  for (const [prefix, label] of Object.entries(SOURCE_BADGE)) {
    if (name.startsWith(prefix)) return label
  }
  return null
}

function getDisplayForSearchResult(r: SearchResult): string {
  if (r.display) return r.display
  // For yf: and fred: names, strip the prefix for the fallback label
  if (r.name.startsWith("yf:")) return r.name.slice(3)
  if (r.name.startsWith("fred:")) return r.name.slice(5)
  return formatSeriesName(r.name)
}

export function MetricPanel({ activeNames, loading, onAdd, onClose }: MetricPanelProps) {
  const [search, setSearch] = useState("")
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

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
        .then((data: SearchResult[] | string[]) => {
          // Handle both old (string[]) and new ({name, display?}[]) formats
          if (Array.isArray(data) && data.length > 0 && typeof data[0] === "string") {
            setSearchResults((data as string[]).map((name) => ({ name })))
          } else {
            setSearchResults(data as SearchResult[])
          }
        })
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false))
    }, 300)

    return () => clearTimeout(timer)
  }, [search])

  const toggleCategory = (name: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const isActive = (name: string) => activeNames.has(name)
  const isLoading = (name: string) => loading.has(name)

  return (
    <div className="w-72 shrink-0 border-r border-border/30 flex flex-col bg-card/30 overflow-hidden">
      <div className="shrink-0 px-3 pt-3 pb-2 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search metrics, tickers..."
            className="w-full bg-background/60 border border-border/40 rounded-md pl-8 pr-8 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring/50 transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <button
          onClick={onClose}
          className="shrink-0 p-1.5 rounded text-muted-foreground/40 hover:text-muted-foreground hover:bg-accent/30 transition-colors lg:hidden"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {search.trim() ? (
          <div>
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
            {searchResults.map((r) => (
              <MetricRow
                key={r.name}
                name={r.name}
                display={getDisplayForSearchResult(r)}
                badge={getSourceBadge(r.name)}
                active={isActive(r.name)}
                loading={isLoading(r.name)}
                onAdd={() => onAdd(r.name, getDisplayForSearchResult(r))}
              />
            ))}
          </div>
        ) : (
          <div className="pb-4">
            {/* ── On-chain metrics (BitView) ── */}
            <CategoryHeader label="On-Chain" dimmed />
            {METRIC_CATEGORIES.map((cat) => (
              <div key={cat.name}>
                <button
                  onClick={() => toggleCategory(cat.name)}
                  className="flex items-center gap-1.5 w-full px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 hover:text-muted-foreground/70 transition-colors sticky top-0 bg-card/30 backdrop-blur-sm z-10"
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
                      onAdd={() => onAdd(m.name, m.display)}
                    />
                  ))}
              </div>
            ))}

            {/* ── Market data (yfinance + FRED) ── */}
            <div className="mt-3">
              <CategoryHeader label="Markets" dimmed />
              {MARKET_CATEGORIES.map((cat) => (
                <div key={cat.name}>
                  <button
                    onClick={() => toggleCategory(`market:${cat.name}`)}
                    className="flex items-center gap-1.5 w-full px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 hover:text-muted-foreground/70 transition-colors sticky top-0 bg-card/30 backdrop-blur-sm z-10"
                  >
                    {collapsed.has(`market:${cat.name}`) ? (
                      <ChevronRight className="h-3 w-3 shrink-0" />
                    ) : (
                      <ChevronDown className="h-3 w-3 shrink-0" />
                    )}
                    {cat.name}
                    <span className="ml-1 font-normal opacity-40 text-[9px] normal-case tracking-normal">
                      {cat.source === "fred" ? "FRED" : "Yahoo Finance"}
                    </span>
                    <span className="ml-auto font-normal opacity-50">{cat.metrics.length}</span>
                  </button>
                  {!collapsed.has(`market:${cat.name}`) &&
                    cat.metrics.map((m) => (
                      <MetricRow
                        key={m.name}
                        name={m.name}
                        display={m.display}
                        badge={cat.source === "fred" ? "FRED" : "Equity"}
                        active={isActive(m.name)}
                        loading={isLoading(m.name)}
                        onAdd={() => onAdd(m.name, m.display)}
                      />
                    ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function CategoryHeader({ label, dimmed }: { label: string; dimmed?: boolean }) {
  return (
    <div
      className={cn(
        "px-4 pt-3 pb-1 text-[9px] font-bold uppercase tracking-widest",
        dimmed ? "text-muted-foreground/30" : "text-muted-foreground/50"
      )}
    >
      {label}
    </div>
  )
}

function MetricRow({
  name,
  display,
  badge,
  active,
  loading,
  onAdd,
}: {
  name: string
  display: string
  badge?: string | null
  active: boolean
  loading: boolean
  onAdd: () => void
}) {
  return (
    <button
      onClick={onAdd}
      disabled={active || loading}
      className={cn(
        "flex items-center gap-2 w-full px-4 py-1.5 text-left transition-colors group",
        active
          ? "opacity-50 cursor-default"
          : "hover:bg-accent/30 cursor-pointer"
      )}
    >
      <div className="flex-1 min-w-0">
        <span className="block text-sm text-foreground truncate">{display}</span>
        <span className="block text-[10px] text-muted-foreground/40 font-mono truncate">{name}</span>
      </div>
      {badge && (
        <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-muted/40 text-muted-foreground/50 shrink-0">
          {badge}
        </span>
      )}
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
