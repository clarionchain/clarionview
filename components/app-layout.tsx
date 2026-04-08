"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  FlaskConical,
  FileText,
  LayoutGrid,
  BookOpen,
  X,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  LogOut,
  Settings,
} from "lucide-react"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { Button } from "@/components/ui/button"
import { useWorkbenchStore } from "@/lib/workbench-store"
import { withBase } from "@/lib/base-path"
import { useWorkbenchSettings } from "@/lib/workbench-settings-dialog-context"
import { WORKBOOK_TEMPLATES } from "@/lib/workbook-templates"
import { cn } from "@/lib/utils"

const DASHBOARDS = [
  { id: "etf",      label: "Bitcoin ETFs",           href: "/dashboards/etf" },
  { id: "mining",   label: "Mining Companies",        href: "/dashboards/mining" },
  { id: "macro",    label: "Federal Reserve / Macro", href: "/dashboards/macro" },
  { id: "strategy", label: "Strategy & Treasury",     href: "/dashboards/strategy" },
]

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [workbenchOpen, setWorkbenchOpen] = useState(true)
  const [dashboardsOpen, setDashboardsOpen] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const store = useWorkbenchStore()
  const { openSettings } = useWorkbenchSettings()
  const router = useRouter()

  const loadTemplate = (templateId: string) => {
    const tpl = WORKBOOK_TEMPLATES.find((t) => t.id === templateId)
    if (!tpl) return
    store.requestLoad({ ...tpl, savedAt: new Date().toISOString() })
    setMobileMenuOpen(false)
    router.push(withBase("/"))
  }

  return (
    <div className="workbench-shell-surface flex h-screen overflow-hidden bg-background">
      {/* Mobile overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Mobile nav */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-72 bg-card border-r border-border transition-transform duration-200 ease-in-out flex flex-col lg:hidden",
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={withBase("/clarionchain_logo.png")} alt="" className="h-7 w-7 object-contain" width={28} height={28} />
            </div>
            <span className="text-sm font-semibold">ClarionChain</span>
          </div>
          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => setMobileMenuOpen(false)} aria-label="Close menu">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-4 space-y-1">
          {/* Workbench */}
          <div>
            <button
              onClick={() => setWorkbenchOpen((v) => !v)}
              className="flex items-center gap-2.5 w-full rounded-md px-3 py-2.5 text-sm font-medium text-foreground hover:bg-accent/30 transition-colors min-h-[44px]"
            >
              <FlaskConical className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-left">Workbench</span>
              {workbenchOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground/40" /> : <ChevronDown className="h-4 w-4 text-muted-foreground/40" />}
            </button>

            {workbenchOpen && (
              <div className="mt-0.5 space-y-0.5 pl-11">
                <button
                  onClick={() => { store.requestNewChart(); setMobileMenuOpen(false) }}
                  className="flex items-center gap-1.5 w-full rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent/30 hover:text-accent-foreground transition-colors min-h-[44px]"
                >
                  <span>New Chart</span>
                  <Plus className="h-3.5 w-3.5 shrink-0" />
                </button>

                {store.savedWorkbooks.map((wb) => {
                  const isActive = store.activeWorkbookName === wb.name
                  return (
                    <div
                      key={wb.id}
                      className={cn(
                        "flex items-center rounded-md transition-colors group",
                        isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/40 hover:text-accent-foreground"
                      )}
                    >
                      <button
                        onClick={() => { store.requestLoad(wb); setMobileMenuOpen(false) }}
                        className="flex-1 flex items-center px-2 py-1.5 text-left min-w-0 min-h-[44px]"
                      >
                        <span className="block text-xs truncate">{wb.name}</span>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); store.deleteWorkbook(wb.id) }}
                        className="p-2 mr-1 rounded text-muted-foreground/20 hover:text-destructive/70 transition-colors shrink-0"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Templates */}
          <div>
            <button
              onClick={() => setTemplatesOpen((v) => !v)}
              className="flex items-center gap-2.5 w-full rounded-md px-3 py-2.5 text-sm font-medium text-foreground hover:bg-accent/30 transition-colors min-h-[44px]"
            >
              <BookOpen className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-left">Templates</span>
              {templatesOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground/40" /> : <ChevronDown className="h-4 w-4 text-muted-foreground/40" />}
            </button>

            {templatesOpen && (
              <div className="mt-0.5 space-y-0.5 pl-11">
                {WORKBOOK_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    onClick={() => loadTemplate(tpl.id)}
                    className="flex items-center w-full rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent/30 hover:text-accent-foreground transition-colors text-left min-h-[44px]"
                  >
                    <span className="truncate">{tpl.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Dashboards */}
          <div>
            <button
              onClick={() => setDashboardsOpen((v) => !v)}
              className="flex items-center gap-2.5 w-full rounded-md px-3 py-2.5 text-sm font-medium text-foreground hover:bg-accent/30 transition-colors min-h-[44px]"
            >
              <LayoutGrid className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-left">Dashboards</span>
              {dashboardsOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground/40" /> : <ChevronDown className="h-4 w-4 text-muted-foreground/40" />}
            </button>

            {dashboardsOpen && (
              <div className="mt-0.5 space-y-0.5 pl-11">
                {DASHBOARDS.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => { router.push(withBase(d.href)); setMobileMenuOpen(false) }}
                    className="flex items-center w-full rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent/30 hover:text-accent-foreground transition-colors text-left min-h-[44px]"
                  >
                    <span className="truncate">{d.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Reports */}
          <button
            onClick={() => { router.push(withBase("/reports")); setMobileMenuOpen(false) }}
            className="flex items-center gap-2.5 w-full rounded-md px-3 py-2.5 text-sm font-medium text-foreground hover:bg-accent/30 transition-colors min-h-[44px]"
          >
            <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
            <span className="flex-1 text-left">Reports</span>
            <span className="text-xs text-muted-foreground/40">Overnight</span>
          </button>
        </div>

        <div className="shrink-0 border-t border-border px-2 py-2 space-y-0.5">
          <button
            type="button"
            onClick={() => { setMobileMenuOpen(false); openSettings("account") }}
            className="flex min-h-[44px] w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground/80 transition-colors hover:bg-accent/30 hover:text-foreground"
          >
            <Settings className="h-5 w-5 shrink-0" />
            <span className="flex-1 text-left">Preferences</span>
          </button>
          <button
            type="button"
            onClick={async () => {
              await fetch(withBase("/api/auth/logout"), { method: "POST", credentials: "include" })
              window.location.href = withBase("/login")
            }}
            className="flex items-center gap-2.5 w-full rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground/80 hover:bg-accent/30 hover:text-foreground transition-colors min-h-[44px]"
          >
            <LogOut className="h-5 w-5 shrink-0" />
            Sign out
          </button>
        </div>

        <div className="shrink-0 border-t border-border p-3">
          <span className="text-xs text-muted-foreground/50">
            Powered by{" "}
            <a href="https://bitview.space" target="_blank" rel="noopener noreferrer" className="text-muted-foreground/70 hover:text-foreground transition-colors">
              bitview.space
            </a>
          </span>
        </div>
      </div>

      {/* Desktop sidebar */}
      <AppSidebar className="hidden lg:flex" />

      {/* Main content */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <SiteHeader onMenuClick={() => setMobileMenuOpen(true)} />
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
