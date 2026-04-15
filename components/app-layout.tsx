"use client"

import { useState, useEffect } from "react"
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
  Network,
  Sigma,
  BarChart2,
  Sparkles,
  Zap,
  LogIn,
} from "lucide-react"
import { AiConfigModal, loadGuestConfig, loadCreditToken } from "@/components/ai-config-modal"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { Button } from "@/components/ui/button"
import { useWorkbenchStore } from "@/lib/workbench-store"
import { withBase } from "@/lib/base-path"
import { useWorkbenchSettings } from "@/lib/workbench-settings-dialog-context"
import { WORKBOOK_TEMPLATES } from "@/lib/workbook-templates"
import { cn } from "@/lib/utils"

const DASHBOARDS = [
  { id: "etf",      label: "Bitcoin ETFs",            href: "/dashboards/etf" },
  { id: "mining",   label: "Mining Companies",        href: "/dashboards/mining" },
  { id: "macro",    label: "Federal Reserve / Macro", href: "/dashboards/macro" },
  { id: "strategy", label: "Strategy & Treasury",     href: "/dashboards/strategy" },
  { id: "quant",    label: "Quant Models",            href: "/dashboards/quant" },
]

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [insightsOpen,   setInsightsOpen]   = useState(true)
  const [workbenchOpen,  setWorkbenchOpen]  = useState(false)
  const [templatesOpen,  setTemplatesOpen]  = useState(false)
  const [dashboardsOpen, setDashboardsOpen] = useState(true)
  const [isLoggedIn,     setIsLoggedIn]     = useState<boolean | null>(null)
  const [showAiModal,    setShowAiModal]    = useState(false)
  const [aiConfigured,   setAiConfigured]   = useState(false)
  const store = useWorkbenchStore()
  const { openSettings } = useWorkbenchSettings()
  const router = useRouter()

  useEffect(() => {
    fetch("/api/ai/settings", { credentials: "include" })
      .then((r) => { setIsLoggedIn(r.ok) })
      .catch(() => { setIsLoggedIn(false) })
    setAiConfigured(Boolean(loadGuestConfig()?.apiKey) || Boolean(loadCreditToken()))
  }, [])

  const close = () => setMobileMenuOpen(false)

  const nav = (href: string, external?: boolean) => {
    close()
    if (external) { window.location.href = href } else { router.push(withBase(href)) }
  }

  const loadTemplate = (templateId: string) => {
    const tpl = WORKBOOK_TEMPLATES.find((t) => t.id === templateId)
    if (!tpl) return
    store.requestLoad({ ...tpl, savedAt: new Date().toISOString() })
    close()
    router.push(withBase("/"))
  }

  function MobileSection({
    icon: Icon,
    label,
    open,
    onToggle,
    onLabelClick,
    children,
  }: {
    icon: React.ElementType
    label: string
    open: boolean
    onToggle: () => void
    onLabelClick?: () => void
    children: React.ReactNode
  }) {
    return (
      <div>
        <div className="flex items-center rounded-md hover:bg-accent/30 transition-colors">
          <button
            onClick={onLabelClick ?? onToggle}
            className="flex items-center gap-2.5 flex-1 px-3 py-2.5 text-sm font-medium text-foreground min-h-[44px]"
          >
            <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
            <span className="flex-1 text-left">{label}</span>
          </button>
          <button
            onClick={onToggle}
            className="px-3 py-2.5 text-muted-foreground/40 hover:text-muted-foreground min-h-[44px]"
          >
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
        {open && <div className="mt-0.5 space-y-0.5 pl-11">{children}</div>}
      </div>
    )
  }

  function MobileSubLink({ href, label, external }: { href: string; label: string; external?: boolean }) {
    return (
      <button
        onClick={() => nav(href, external)}
        className="flex items-center w-full rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent/30 hover:text-accent-foreground transition-colors text-left min-h-[44px]"
      >
        <span className="truncate">{label}</span>
      </button>
    )
  }

  return (
    <div className="workbench-shell-surface flex h-screen overflow-hidden bg-background">
      {/* Mobile overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={close}
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
            <span className="text-sm font-semibold">ClarionView</span>
          </div>
          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={close} aria-label="Close menu">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-4 space-y-1">

          {/* Insights */}
          <MobileSection
            icon={Sparkles}
            label="Insights"
            open={insightsOpen}
            onToggle={() => setInsightsOpen((v) => !v)}
          >
            <MobileSubLink href="/dashboards/insights" label="Daily Summary" />
            <MobileSubLink href="/reports" label="Reports" />
            <MobileSubLink href="/dashboards/metrics" label="Metrics" />
          </MobileSection>

          {/* Workbench */}
          <MobileSection
            icon={FlaskConical}
            label="Workbench"
            open={workbenchOpen}
            onToggle={() => setWorkbenchOpen((v) => !v)}
            onLabelClick={() => nav("/")}
          >
            <button
              onClick={() => { store.requestNewChart(); close() }}
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
                    onClick={() => { store.requestLoad(wb); close() }}
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

            {/* Templates nested under Workbench */}
            <div className="pt-1">
              <button
                onClick={() => setTemplatesOpen((v) => !v)}
                className="flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent/30 hover:text-accent-foreground transition-colors min-h-[44px]"
              >
                <BookOpen className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1 text-left">Templates</span>
                {templatesOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
              {templatesOpen && (
                <div className="mt-0.5 space-y-0.5 pl-5">
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
          </MobileSection>

          {/* Intel */}
          <button
            onClick={() => nav("/intel/", true)}
            className="flex items-center gap-2.5 w-full rounded-md px-3 py-2.5 text-sm font-medium text-foreground hover:bg-accent/30 transition-colors min-h-[44px]"
          >
            <Network className="h-5 w-5 shrink-0 text-muted-foreground" />
            <span className="flex-1 text-left">Intel</span>
            <span className="text-xs text-muted-foreground/40">Daily</span>
          </button>

          {/* Dashboards */}
          <MobileSection
            icon={LayoutGrid}
            label="Dashboards"
            open={dashboardsOpen}
            onToggle={() => setDashboardsOpen((v) => !v)}
          >
            {DASHBOARDS.map((d) => (
              <MobileSubLink key={d.id} href={d.href} label={d.label} />
            ))}
          </MobileSection>

        </div>

        <div className="shrink-0 border-t border-border px-2 py-2 space-y-0.5">
          {isLoggedIn ? (
            <>
              <button type="button"
                onClick={() => { close(); openSettings("account") }}
                className="flex min-h-[44px] w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground/80 transition-colors hover:bg-accent/30 hover:text-foreground"
              >
                <Settings className="h-5 w-5 shrink-0" />
                <span className="flex-1 text-left">Settings</span>
              </button>
              <button type="button"
                onClick={async () => {
                  await fetch(withBase("/api/auth/logout"), { method: "POST", credentials: "include" })
                  window.location.href = withBase("/login")
                }}
                className="flex items-center gap-2.5 w-full rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground/80 hover:bg-accent/30 hover:text-foreground transition-colors min-h-[44px]"
              >
                <LogOut className="h-5 w-5 shrink-0" />
                Sign out
              </button>
            </>
          ) : (
            <>
              <button type="button"
                onClick={() => { close(); setShowAiModal(true) }}
                className={`flex min-h-[44px] w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-medium transition-colors hover:bg-accent/30 ${aiConfigured ? "text-cyan-400/80 hover:text-cyan-300" : "text-muted-foreground/80 hover:text-foreground"}`}
              >
                <Zap className="h-5 w-5 shrink-0" />
                <span className="flex-1 text-left">{aiConfigured ? "AI configured" : "Configure AI"}</span>
              </button>
              <button type="button"
                onClick={() => { close(); router.push(withBase("/login")) }}
                className="flex items-center gap-2.5 w-full rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground/60 hover:bg-accent/30 hover:text-foreground transition-colors min-h-[44px]"
              >
                <LogIn className="h-5 w-5 shrink-0" />
                Sign in
              </button>
            </>
          )}
        </div>

        {showAiModal && (
          <AiConfigModal
            onClose={() => setShowAiModal(false)}
            onConfigured={() => { setAiConfigured(true); setShowAiModal(false) }}
          />
        )}

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
