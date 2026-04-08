"use client"

import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react"
import { usePathname } from "next/navigation"
import { basePath, withBase } from "@/lib/base-path"
import type { SavedWorkbook } from "./workbench-types"

function loginRoutePath(): string {
  const trimmed = basePath.replace(/\/$/, "")
  return trimmed ? `${trimmed}/login` : "/login"
}

type LoadHandler = (wb: SavedWorkbook) => void
type NewChartHandler = () => void

interface StoreValue {
  savedWorkbooks: SavedWorkbook[]
  activeWorkbookName: string
  setActiveWorkbookName: (name: string) => void
  saveWorkbook: (wb: SavedWorkbook) => Promise<void>
  deleteWorkbook: (id: string) => Promise<void>
  reorderWorkbooks: (fromIndex: number, toIndex: number) => void
  requestLoad: (wb: SavedWorkbook) => void
  requestNewChart: () => void
  registerLoadHandler: (fn: LoadHandler) => void
  registerNewChartHandler: (fn: NewChartHandler) => void
}

const Ctx = createContext<StoreValue | null>(null)

export function WorkbenchStoreProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [savedWorkbooks, setSavedWorkbooks] = useState<SavedWorkbook[]>([])
  const [activeWorkbookName, setActiveWorkbookName] = useState("Untitled")
  const loadRef = useRef<LoadHandler | null>(null)
  const newRef = useRef<NewChartHandler | null>(null)

  // Refetch when the route changes (e.g. client navigates from /login → / after sign-in).
  // The provider lives in the root layout and does not remount on login, so a one-time [] effect
  // would leave savedWorkbooks empty forever after a 401 on the login page.
  useEffect(() => {
    const loginPath = loginRoutePath()
    if (pathname === loginPath || pathname === `${loginPath}/`) return

    let cancelled = false
    fetch(withBase("/api/workbooks"), { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: unknown) => {
        if (cancelled || !Array.isArray(data)) return
        setSavedWorkbooks(data as SavedWorkbook[])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [pathname])

  const saveWorkbook = useCallback(async (wb: SavedWorkbook) => {
    const res = await fetch(withBase("/api/workbooks"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(wb),
    })
    if (!res.ok) {
      console.error("Save workbook failed:", await res.text())
      return
    }
    const saved = (await res.json()) as SavedWorkbook
    setSavedWorkbooks((prev) => [saved, ...prev.filter((w) => w.name !== saved.name)].slice(0, 50))
  }, [])

  const deleteWorkbook = useCallback(async (id: string) => {
    const res = await fetch(withBase(`/api/workbooks?id=${encodeURIComponent(id)}`), {
      method: "DELETE",
      credentials: "include",
    })
    if (!res.ok) return
    setSavedWorkbooks((prev) => prev.filter((w) => w.id !== id))
  }, [])

  const reorderWorkbooks = useCallback((fromIndex: number, toIndex: number) => {
    setSavedWorkbooks((prev) => {
      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      const ids = next.map((w) => w.id)
      fetch(withBase("/api/workbooks/reorder"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ids }),
      }).catch(() => {})
      return next
    })
  }, [])

  const requestLoad = useCallback((wb: SavedWorkbook) => {
    loadRef.current?.(wb)
  }, [])
  const requestNewChart = useCallback(() => {
    newRef.current?.()
  }, [])
  const registerLoadHandler = useCallback((fn: LoadHandler) => {
    loadRef.current = fn
  }, [])
  const registerNewChartHandler = useCallback((fn: NewChartHandler) => {
    newRef.current = fn
  }, [])

  return (
    <Ctx.Provider
      value={{
        savedWorkbooks,
        activeWorkbookName,
        setActiveWorkbookName,
        saveWorkbook,
        deleteWorkbook,
        reorderWorkbooks,
        requestLoad,
        requestNewChart,
        registerLoadHandler,
        registerNewChartHandler,
      }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useWorkbenchStore() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useWorkbenchStore must be used within WorkbenchStoreProvider")
  return ctx
}
