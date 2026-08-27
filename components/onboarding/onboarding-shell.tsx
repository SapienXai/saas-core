"use client"

import type React from "react"
import Link from "next/link"
import { ArrowLeft, Check, Circle, Sparkles } from "lucide-react"
import type { TranslationKey, TranslationReplacements } from "@/i18n"

type OnboardingPhase = "source" | "scanning" | "review" | "done"

type OnboardingShellProps = {
  children: React.ReactNode
  phase: OnboardingPhase
  isAdditionalRestaurant: boolean
  exitHref: string
  getTranslation: (key: TranslationKey, replacements?: TranslationReplacements) => string
}

export function OnboardingShell({ children, phase, isAdditionalRestaurant, exitHref, getTranslation }: OnboardingShellProps) {
  const currentStep = phase === "source" || phase === "scanning" ? 1 : phase === "review" ? 2 : 3
  const steps = [
    getTranslation("onboarding.restaurant"),
    getTranslation("onboarding.profile"),
    getTranslation("onboarding.linksPublish"),
  ]
  const exitLabel = isAdditionalRestaurant ? getTranslation("onboarding.backToWorkspace") : getTranslation("onboarding.exitSetup")

  return (
    <div className="min-h-dvh bg-[#f7f4ef] text-stone-950">
      <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-[#f7f4ef]/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link href={exitHref} className="flex min-w-0 items-center gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-950/20">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-stone-950 text-sm font-bold text-white shadow-sm">R</span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold tracking-tight">Reservevia</span>
                <span className="block truncate text-[9px] font-bold uppercase tracking-[0.2em] text-stone-500">{getTranslation("onboarding.navigationLabel")}</span>
              </span>
            </Link>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden items-center gap-1.5 text-xs font-medium text-stone-500 sm:flex"><Sparkles className="h-3.5 w-3.5 text-amber-500" />{getTranslation("onboarding.progressSaved")}</span>
            <Link href={exitHref} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 text-xs font-semibold text-stone-700 shadow-sm transition hover:border-stone-300 hover:text-stone-950">
              <span className="hidden sm:inline">{exitLabel}</span>
              <ArrowLeft className="h-3.5 w-3.5 sm:hidden" />
              <span className="sm:hidden">{getTranslation("onboarding.exitSetup")}</span>
            </Link>
          </div>
        </div>

        <div className="mx-auto mt-3 flex max-w-[1440px] items-center justify-between gap-3 lg:hidden">
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-stone-500">{getTranslation("onboarding.setupProgress")}</span>
          <span className="text-xs font-semibold text-stone-700">{getTranslation("onboarding.step", { step: currentStep })}</span>
        </div>
        <div className="mx-auto mt-2 flex max-w-[1440px] gap-1.5 lg:hidden" aria-label={getTranslation("onboarding.setupProgress")}>
          {steps.map((step, index) => (
            <span key={step} className={`h-1.5 flex-1 rounded-full ${index < currentStep ? "bg-stone-950" : "bg-stone-200"}`} aria-label={step} />
          ))}
        </div>
      </header>

      <div className="mx-auto flex min-h-[calc(100dvh-5.25rem)] max-w-[1440px]">
        <aside className="hidden w-[248px] shrink-0 border-r border-stone-200/80 px-6 py-8 lg:flex lg:flex-col">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-stone-500">{getTranslation("onboarding.setupProgress")}</p>
            <p className="mt-2 text-sm leading-5 text-stone-600">{getTranslation("onboarding.progressSaved")}</p>
          </div>
          <nav className="mt-8" aria-label={getTranslation("onboarding.setupProgress")}>
            <ol className="space-y-2">
              {steps.map((step, index) => {
                const stepNumber = index + 1
                const complete = stepNumber < currentStep
                const active = stepNumber === currentStep
                return (
                  <li key={step} className={`flex items-center gap-3 rounded-2xl px-3 py-3 ${active ? "bg-white shadow-sm ring-1 ring-stone-200" : ""}`}>
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${complete ? "bg-emerald-100 text-emerald-700" : active ? "bg-stone-950 text-white" : "bg-stone-200 text-stone-500"}`}>
                      {complete ? <Check className="h-4 w-4" /> : active ? stepNumber : <Circle className="h-3.5 w-3.5" />}
                    </span>
                    <span className={`text-xs font-bold tracking-wide ${active ? "text-stone-950" : complete ? "text-stone-600" : "text-stone-400"}`}>{step}</span>
                  </li>
                )
              })}
            </ol>
          </nav>
          <div className="mt-auto border-t border-stone-200 pt-5">
            <Link href={exitHref} className="inline-flex items-center gap-2 text-xs font-semibold text-stone-500 transition hover:text-stone-950"><ArrowLeft className="h-3.5 w-3.5" />{exitLabel}</Link>
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
          {children}
        </main>
      </div>
    </div>
  )
}
