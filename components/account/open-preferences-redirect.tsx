"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { withBase } from "@/lib/base-path"
import { useWorkbenchSettings } from "@/lib/workbench-settings-dialog-context"

export function OpenPreferencesRedirect({
  tab = "account",
}: {
  tab?: "account" | "ai" | "team"
}) {
  const router = useRouter()
  const { openSettings } = useWorkbenchSettings()

  useEffect(() => {
    openSettings(tab)
    router.replace(withBase("/"))
  }, [openSettings, router, tab])

  return (
    <p className="py-8 text-center text-sm text-muted-foreground">
      Opening preferences…
    </p>
  )
}
