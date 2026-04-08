"use client"

import { useEffect, useRef } from "react"

type VantaInstance = { destroy: () => void }

export function LoginBackdrop() {
  const elRef = useRef<HTMLDivElement>(null)
  const vantaRef = useRef<VantaInstance | null>(null)

  useEffect(() => {
    const el = elRef.current
    if (!el) return

    const reduceMotion =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches

    if (reduceMotion) {
      el.style.background = "#020408"
      return
    }

    let cancelled = false

    void (async () => {
      const THREE = await import("three")
      const { default: NET } = await import("vanta/dist/vanta.net.min")
      if (cancelled || !elRef.current) return

      vantaRef.current = NET({
        el: elRef.current,
        THREE,
        mouseControls: true,
        touchControls: true,
        gyroControls: false,
        minHeight: 200,
        minWidth: 200,
        scale: 1,
        scaleMobile: 1,
        color: 0x22d3ee,
        backgroundColor: 0x020408,
        backgroundAlpha: 1,
        points: 11,
        maxDistance: 21,
        spacing: 16,
        showDots: true,
      })
    })()

    return () => {
      cancelled = true
      vantaRef.current?.destroy()
      vantaRef.current = null
    }
  }, [])

  return (
    <div className="login-vanta-root absolute inset-0 z-0 overflow-hidden bg-[#020408]" aria-hidden>
      <div ref={elRef} className="absolute inset-0 h-full min-h-full w-full" />
      <div className="login-vanta-vignette" />
    </div>
  )
}
