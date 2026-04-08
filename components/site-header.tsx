"use client"

import { Menu } from "lucide-react"
import { Button } from "@/components/ui/button"

export function SiteHeader({ onMenuClick }: { onMenuClick?: () => void }) {
  return (
    <header className="flex h-12 shrink-0 items-center border-b border-border px-3 lg:hidden">
      {onMenuClick && (
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={onMenuClick}
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
      )}
      <span className="ml-2 text-sm font-semibold text-foreground">Workbench</span>
    </header>
  )
}
