"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { X } from "lucide-react"
import {
  useWorkbenchSettings,
  type WorkbenchSettingsTab,
} from "@/lib/workbench-settings-dialog-context"
import { withBase } from "@/lib/base-path"
import { cn } from "@/lib/utils"
import { ChangePasswordForm } from "@/components/account/change-password-form"
import { AiModelsSettingsForm } from "@/components/workbench/ai-models-settings-form"

const TABS: { id: WorkbenchSettingsTab; label: string }[] = [
  { id: "account", label: "Account" },
  { id: "ai", label: "AI & models" },
  { id: "team", label: "Team" },
]

export function WorkbenchSettingsDialog() {
  const { open, tab, closeSettings, setTab } = useWorkbenchSettings()
  const [showTeamTab, setShowTeamTab] = useState(false)
  const [adminCheckDone, setAdminCheckDone] = useState(false)

  useEffect(() => {
    if (!open) return
    setAdminCheckDone(false)
    fetch(withBase("/api/admin/users"), { credentials: "include" })
      .then((r) => setShowTeamTab(r.ok))
      .catch(() => setShowTeamTab(false))
      .finally(() => setAdminCheckDone(true))
  }, [open])

  useEffect(() => {
    if (open && adminCheckDone && tab === "team" && !showTeamTab) {
      setTab("account")
    }
  }, [open, adminCheckDone, tab, showTeamTab, setTab])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSettings()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, closeSettings])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open) return null

  const visibleTabs = TABS.filter((t) => t.id !== "team" || showTeamTab)

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 backdrop-blur-[2px]"
        style={{ backgroundColor: "color-mix(in srgb, var(--workbench-shell) 72%, transparent)" }}
        aria-label="Close preferences"
        onClick={closeSettings}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="workbench-settings-title"
        className="relative z-[101] flex max-h-[min(90vh,720px)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
          <h2 id="workbench-settings-title" className="min-w-0 flex-1 text-sm font-semibold tracking-tight text-foreground">
            Preferences
          </h2>
          <button
            type="button"
            onClick={closeSettings}
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex shrink-0 gap-1 border-b border-border px-3 py-2">
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                tab === t.id
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === "account" ? (
            <div className="space-y-6">
              <ChangePasswordForm title="Password" />
            </div>
          ) : null}
          {tab === "ai" ? <AiModelsSettingsForm /> : null}
          {tab === "team" && showTeamTab ? (
            <section className="rounded-lg border border-border/40 bg-card/40 p-4">
              <h2 className="mb-2 text-sm font-medium text-muted-foreground">Team</h2>
              <p className="mb-4 text-xs text-muted-foreground/85 leading-relaxed">
                Manage users and roles in the admin area. This opens in the same window so you can return here afterward.
              </p>
              <Link
                href={withBase("/admin/users")}
                onClick={closeSettings}
                className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Open user admin
              </Link>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  )
}
