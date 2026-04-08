"use client"

import { WorkbenchStoreProvider } from "@/lib/workbench-store"
import { WorkbenchSettingsProvider } from "@/lib/workbench-settings-dialog-context"
import { WorkbenchSettingsDialog } from "@/components/workbench/workbench-settings-dialog"

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <WorkbenchStoreProvider>
      <WorkbenchSettingsProvider>
        {children}
        <WorkbenchSettingsDialog />
      </WorkbenchSettingsProvider>
    </WorkbenchStoreProvider>
  )
}
