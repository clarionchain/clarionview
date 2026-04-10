"use client"

import { useState } from "react"
import { Bitcoin, Cloud, CreditCard, Server, Zap, X } from "lucide-react"
import { withBase } from "@/lib/base-path"
import { cn } from "@/lib/utils"

type Step = "payment" | "provider"
type Provider = "openrouter" | "routstr" | "local"

const PAYMENT_OPTIONS = [
  { id: "stripe",    label: "Card",      Icon: CreditCard, color: "text-violet-400" },
  { id: "bitcoin",   label: "Bitcoin",   Icon: Bitcoin,    color: "text-orange-400" },
  { id: "lightning", label: "Lightning", Icon: Zap,        color: "text-yellow-400" },
  { id: "cashu",     label: "Cashu",     Icon: Zap,        color: "text-emerald-400" },
  { id: "ark",       label: "Ark",       Icon: Zap,        color: "text-cyan-400"    },
  { id: "l402",      label: "L402",      Icon: Zap,        color: "text-blue-400"   },
] as const

const PROVIDERS = [
  {
    id: "openrouter" as Provider,
    Icon: Cloud,
    label: "OpenRouter",
    desc: "Cloud models — GPT-4o, Claude, Llama and more",
  },
  {
    id: "routstr" as Provider,
    Icon: Zap,
    label: "Routstr",
    desc: "Decentralized AI via Bitcoin / Lightning",
  },
  {
    id: "local" as Provider,
    Icon: Server,
    label: "Local",
    desc: "Your own Ollama, LM Studio, or vLLM server",
  },
]

interface OnboardingModalProps {
  onComplete: (provider: Provider) => void
  onDismiss: () => void
}

export function OnboardingModal({ onComplete, onDismiss }: OnboardingModalProps) {
  const [step, setStep] = useState<Step>("payment")
  const [saving, setSaving] = useState(false)

  async function selectProvider(p: Provider) {
    setSaving(true)
    try {
      await fetch(withBase("/api/ai/settings"), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aiChatProvider: p,
          openrouterKeyAction: "keep",
          localApiKeyAction: "keep",
          routstrKeyAction: "keep",
          aiKeySource: "auto",
          aiAllowPlatform: true,
        }),
      })
    } catch { /* non-fatal */ } finally {
      setSaving(false)
    }
    onComplete(p)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-sm rounded-2xl border border-border/50 bg-card shadow-2xl shadow-black/60">
        <button
          type="button"
          onClick={onDismiss}
          className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        {step === "payment" ? (
          <div className="p-6">
            <h2 className="mb-1 text-base font-semibold text-foreground">Get started</h2>
            <p className="mb-5 text-xs text-muted-foreground/70">Choose a payment method to activate AI features.</p>

            <div className="grid grid-cols-3 gap-2 mb-4">
              {PAYMENT_OPTIONS.map(({ id, label, Icon, color }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setStep("provider")}
                  className="flex flex-col items-center gap-1.5 rounded-xl border border-border/40 bg-background/40 p-3 text-center transition-all hover:border-border hover:bg-background/80 hover:scale-[1.02]"
                >
                  <Icon className={cn("h-5 w-5", color)} />
                  <span className="text-[11px] font-medium text-foreground/80">{label}</span>
                  <span className="text-[9px] text-muted-foreground/40">Soon</span>
                </button>
              ))}
            </div>

            <p className="text-center text-[10px] text-muted-foreground/40">
              Payment processing coming soon — skip to choose a provider.
            </p>
            <button
              type="button"
              onClick={() => setStep("provider")}
              className="mt-3 w-full rounded-lg border border-border/30 py-2 text-xs text-muted-foreground/60 hover:text-foreground transition-colors"
            >
              Skip for now →
            </button>
          </div>
        ) : (
          <div className="p-6">
            <h2 className="mb-1 text-base font-semibold text-foreground">Choose AI provider</h2>
            <p className="mb-5 text-xs text-muted-foreground/70">You can change this anytime in settings.</p>

            <div className="space-y-2">
              {PROVIDERS.map(({ id, Icon, label, desc }) => (
                <button
                  key={id}
                  type="button"
                  disabled={saving}
                  onClick={() => void selectProvider(id)}
                  className="flex w-full items-center gap-3 rounded-xl border border-border/40 bg-background/40 p-3 text-left transition-all hover:border-primary/40 hover:bg-primary/5 disabled:opacity-50"
                >
                  <Icon className="h-5 w-5 shrink-0 text-primary/70" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{label}</p>
                    <p className="text-[11px] text-muted-foreground/60 truncate">{desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
