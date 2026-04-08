"use client"

import { createContext, useCallback, useContext, useState } from "react"

export type WorkbenchSettingsTab = "account" | "ai" | "team"

type WorkbenchSettingsContextValue = {
  open: boolean
  tab: WorkbenchSettingsTab
  openSettings: (tab?: WorkbenchSettingsTab) => void
  closeSettings: () => void
  setTab: (tab: WorkbenchSettingsTab) => void
}

const WorkbenchSettingsContext = createContext<WorkbenchSettingsContextValue | null>(null)

export function WorkbenchSettingsProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<WorkbenchSettingsTab>("account")

  const openSettings = useCallback((nextTab: WorkbenchSettingsTab = "account") => {
    setTab(nextTab)
    setOpen(true)
  }, [])

  const closeSettings = useCallback(() => setOpen(false), [])

  return (
    <WorkbenchSettingsContext.Provider value={{ open, tab, openSettings, closeSettings, setTab }}>
      {children}
    </WorkbenchSettingsContext.Provider>
  )
}

export function useWorkbenchSettings() {
  const ctx = useContext(WorkbenchSettingsContext)
  if (!ctx) {
    throw new Error("useWorkbenchSettings must be used within WorkbenchSettingsProvider")
  }
  return ctx
}
