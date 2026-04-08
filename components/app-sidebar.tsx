"use client"

import { useState, useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  FlaskConical,
  FileText,
  BarChart3,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  LogOut,
  Settings,
  LayoutGrid,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip"
import { useWorkbenchStore } from "@/lib/workbench-store"
import { withBase } from "@/lib/base-path"
import { useWorkbenchSettings } from "@/lib/workbench-settings-dialog-context"
import { WORKBOOK_TEMPLATES } from "@/lib/workbook-templates"

const DASHBOARDS = [
  { id: "etf",      label: "Bitcoin ETFs",         href: "/dashboards/etf" },
  { id: "mining",   label: "Mining Companies",      href: "/dashboards/mining" },
  { id: "macro",    label: "Federal Reserve / Macro", href: "/dashboards/macro" },
  { id: "strategy", label: "Strategy & Treasury",   href: "/dashboards/strategy" },
]

export function AppSidebar({ className }: { className?: string }) {
  const [collapsed, setCollapsed] = useState(false)
  const [workbenchOpen, setWorkbenchOpen] = useState(true)
  const [dashboardsOpen, setDashboardsOpen] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [reportsOpen, setReportsOpen] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const store = useWorkbenchStore()
  const { openSettings } = useWorkbenchSettings()
  const pathname = usePathname()
  const router = useRouter()

  const handleDragStart = (index: number) => (e: React.DragEvent) => {
    setDragIndex(index)
    e.dataTransfer.effectAllowed = "move"
  }

  const handleDragOver = (index: number) => (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    setDropIndex(index)
  }

  const handleDrop = (index: number) => (e: React.DragEvent) => {
    e.preventDefault()
    if (dragIndex !== null && dragIndex !== index) {
      store.reorderWorkbooks(dragIndex, index)
    }
    setDragIndex(null)
    setDropIndex(null)
  }

  const handleDragEnd = () => {
    setDragIndex(null)
    setDropIndex(null)
  }

  const loadTemplate = (templateId: string) => {
    const tpl = WORKBOOK_TEMPLATES.find((t) => t.id === templateId)
    if (!tpl) return
    store.requestLoad({ ...tpl, savedAt: new Date().toISOString() })
    router.push(withBase("/"))
  }

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "workbench-shell-surface relative flex h-screen flex-col border-r border-border bg-card transition-[width] duration-200 ease-in-out",
          collapsed ? "w-16" : "w-60",
          className
        )}
      >
        {/* Header */}
        <div
          className={cn(
            "flex min-h-16 shrink-0 items-center border-b border-border",
            collapsed ? "flex-col justify-center gap-1 py-3" : "gap-3 px-4 pr-12"
          )}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={withBase("/clarionchain_logo.png")}
              alt=""
              className="h-7 w-7 object-contain"
              width={28}
              height={28}
            />
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1 flex flex-col justify-center gap-0.5 overflow-hidden">
              <span className="truncate text-sm font-semibold">ClarionChain</span>
            </div>
          )}
        </div>

        {/* Collapse toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "absolute top-4 right-2 z-10 h-8 w-8 shrink-0 rounded-md border border-border bg-card text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground",
                collapsed && "right-1 top-1/2 -translate-y-1/2"
              )}
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            {collapsed ? "Expand sidebar" : "Collapse sidebar"}
          </TooltipContent>
        </Tooltip>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">

          {/* ── Workbench ── */}
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => { setCollapsed(false); setWorkbenchOpen(true) }}
                  className="flex items-center justify-center w-full rounded-md px-2 py-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  <FlaskConical className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>Workbench</TooltipContent>
            </Tooltip>
          ) : (
            <div>
              <button
                onClick={() => setWorkbenchOpen((v) => !v)}
                className="flex items-center gap-2.5 w-full rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-accent/30 transition-colors"
              >
                <FlaskConical className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 text-left">Workbench</span>
                {workbenchOpen ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground/40" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/40" />}
              </button>

              {workbenchOpen && (
                <div className="mt-0.5 space-y-0.5 pl-9">
                  <button
                    onClick={() => store.requestNewChart()}
                    className="flex items-center gap-1.5 w-full rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent/30 hover:text-accent-foreground transition-colors"
                  >
                    <span>New Chart</span>
                    <Plus className="h-3 w-3 shrink-0" />
                  </button>

                  {store.savedWorkbooks.map((wb, i) => {
                    const isActive = store.activeWorkbookName === wb.name
                    const isDragging = dragIndex === i
                    const isDropTarget = dropIndex === i && dragIndex !== i
                    return (
                      <div
                        key={wb.id}
                        draggable
                        onDragStart={handleDragStart(i)}
                        onDragOver={handleDragOver(i)}
                        onDrop={handleDrop(i)}
                        onDragEnd={handleDragEnd}
                        className={cn(
                          "flex items-center rounded-md transition-colors group cursor-grab active:cursor-grabbing",
                          isDragging && "opacity-30",
                          isDropTarget && "border-t border-primary/40",
                          isActive
                            ? "bg-accent text-accent-foreground"
                            : "text-muted-foreground hover:bg-accent/40 hover:text-accent-foreground"
                        )}
                      >
                        <button
                          onClick={() => store.requestLoad(wb)}
                          className="flex-1 flex items-center px-2 py-1 text-left min-w-0"
                        >
                          <span className="block text-xs truncate">{wb.name}</span>
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); store.deleteWorkbook(wb.id) }}
                          className="p-1 mr-0.5 rounded text-transparent group-hover:text-muted-foreground/30 hover:!text-destructive/70 transition-colors shrink-0"
                          title="Delete"
                        >
                          <Trash2 className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Templates ── */}
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => { setCollapsed(false); setTemplatesOpen(true) }}
                  className="flex items-center justify-center w-full rounded-md px-2 py-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  <BookOpen className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>Templates</TooltipContent>
            </Tooltip>
          ) : (
            <div>
              <button
                onClick={() => setTemplatesOpen((v) => !v)}
                className="flex items-center gap-2.5 w-full rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-accent/30 transition-colors"
              >
                <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 text-left">Templates</span>
                {templatesOpen ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground/40" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/40" />}
              </button>

              {templatesOpen && (
                <div className="mt-0.5 space-y-0.5 pl-9">
                  {WORKBOOK_TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.id}
                      onClick={() => loadTemplate(tpl.id)}
                      className="flex items-center gap-1.5 w-full rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent/30 hover:text-accent-foreground transition-colors text-left"
                    >
                      <span className="truncate">{tpl.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Dashboards ── */}
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => { setCollapsed(false); setDashboardsOpen(true) }}
                  className="flex items-center justify-center w-full rounded-md px-2 py-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>Dashboards</TooltipContent>
            </Tooltip>
          ) : (
            <div>
              <button
                onClick={() => setDashboardsOpen((v) => !v)}
                className="flex items-center gap-2.5 w-full rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-accent/30 transition-colors"
              >
                <LayoutGrid className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 text-left">Dashboards</span>
                {dashboardsOpen ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground/40" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/40" />}
              </button>

              {dashboardsOpen && (
                <div className="mt-0.5 space-y-0.5 pl-9">
                  {DASHBOARDS.map((d) => {
                    const isActive = pathname === withBase(d.href)
                    return (
                      <button
                        key={d.id}
                        onClick={() => router.push(withBase(d.href))}
                        className={cn(
                          "flex items-center w-full rounded-md px-2 py-1 text-xs transition-colors text-left",
                          isActive
                            ? "bg-accent text-accent-foreground"
                            : "text-muted-foreground hover:bg-accent/30 hover:text-accent-foreground"
                        )}
                      >
                        <span className="truncate">{d.label}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Reports ── */}
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => router.push(withBase("/reports"))}
                  className={cn(
                    "flex items-center justify-center w-full rounded-md px-2 py-2 transition-colors",
                    pathname === withBase("/reports")
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <FileText className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>Reports</TooltipContent>
            </Tooltip>
          ) : (
            <button
              onClick={() => router.push(withBase("/reports"))}
              className={cn(
                "flex items-center gap-2.5 w-full rounded-md px-3 py-2 text-sm font-medium transition-colors",
                pathname === withBase("/reports")
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground hover:bg-accent/30"
              )}
            >
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-left">Reports</span>
              <span className="text-[10px] text-muted-foreground/40">Overnight</span>
            </button>
          )}

          {/* ── Admin: Users ── */}
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => router.push(withBase("/admin/users"))}
                  className={cn(
                    "flex items-center justify-center w-full rounded-md px-2 py-2 transition-colors",
                    pathname === withBase("/admin/users")
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground/50 hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <BarChart3 className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>Admin: Users</TooltipContent>
            </Tooltip>
          ) : (
            <button
              onClick={() => router.push(withBase("/admin/users"))}
              className={cn(
                "flex items-center gap-2.5 w-full rounded-md px-3 py-2 text-sm font-medium transition-colors",
                pathname === withBase("/admin/users")
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground/40 hover:bg-accent/30 hover:text-muted-foreground"
              )}
            >
              <BarChart3 className="h-4 w-4 shrink-0" />
              <span className="flex-1 text-left">Users</span>
              <span className="text-[10px] text-muted-foreground/30">Admin</span>
            </button>
          )}
        </div>

        <Separator />

        <div className={cn("shrink-0 space-y-0.5 px-2 pb-1", collapsed && "px-1")}>
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => { setCollapsed(false); openSettings("account") }}
                  className="flex w-full items-center justify-center rounded-md px-2 py-2 text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                  aria-label="Settings"
                >
                  <Settings className="h-4 w-4 shrink-0" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>Settings</TooltipContent>
            </Tooltip>
          ) : (
            <button
              type="button"
              onClick={() => openSettings("account")}
              className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground/60 transition-colors hover:bg-accent/30 hover:text-foreground"
            >
              <Settings className="h-4 w-4 shrink-0" />
              <span className="flex-1 text-left text-xs">Preferences</span>
            </button>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "w-full justify-start gap-2 text-muted-foreground/60 hover:text-foreground",
                  collapsed && "justify-center px-0"
                )}
                onClick={async () => {
                  await fetch(withBase("/api/auth/logout"), { method: "POST", credentials: "include" })
                  window.location.href = withBase("/login")
                }}
              >
                <LogOut className="h-4 w-4 shrink-0" />
                {!collapsed && <span className="text-xs">Sign out</span>}
              </Button>
            </TooltipTrigger>
            {collapsed && <TooltipContent side="right">Sign out</TooltipContent>}
          </Tooltip>
        </div>

        <div className={cn("shrink-0 p-2", !collapsed && "p-3")}>
          <div className={cn("flex items-center rounded-md text-xs text-muted-foreground/50", collapsed ? "justify-center p-1" : "gap-2 px-3 py-2")}>
            {!collapsed && (
              <span className="truncate">
                Powered by{" "}
                <a href="https://bitview.space" target="_blank" rel="noopener noreferrer" className="text-muted-foreground/70 hover:text-foreground transition-colors">
                  bitview.space
                </a>
              </span>
            )}
          </div>
        </div>
      </aside>
    </TooltipProvider>
  )
}
