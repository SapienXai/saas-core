"use client"

import { useEffect, useRef } from "react"
import { ArrowRight, Check, CircleCheck, Sparkles, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useLanguage } from "@/context/language-context"
import { formatDate as formatLocalizedDate } from "@/i18n/format"
import type { TranslationKey } from "@/i18n"
import { BillingOverlayPortal } from "@/components/manage/billing-overlay-portal"

type BillingSuccessKind = "purchase" | "upgrade" | "downgrade" | "billing"

type BillingSuccessExperienceProps = {
  kind: BillingSuccessKind
  planName: string
  interval: string
  highlights: TranslationKey[]
  effectiveAt?: string | null
  fromPlanName?: string | null
  onClose: () => void
  onContinue: () => void
  onManageBilling: () => void
}

const CONFETTI_COLORS = ["#7c3aed", "#10b981", "#4f46e5", "#f59e0b", "#ec4899", "#06b6d4"]

const CONFETTI = Array.from({ length: 36 }, (_, index) => ({
  left: `${2 + ((index * 17) % 96)}%`,
  delay: `${(index * 73) % 620}ms`,
  color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
  duration: `${2.2 + ((index * 11) % 10) / 10}s`,
}))

export function BillingSuccessExperience({
  kind,
  planName,
  interval,
  highlights,
  effectiveAt,
  fromPlanName,
  onClose,
  onContinue,
  onManageBilling,
}: BillingSuccessExperienceProps) {
  const { currentLang, getTranslation } = useLanguage()
  const t = getTranslation
  const continueRef = useRef<HTMLButtonElement>(null)
  const effectiveDate = effectiveAt ? formatLocalizedDate(effectiveAt, currentLang, { dateStyle: "medium" }) : null
  const isDowngrade = kind === "downgrade"

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const previousSuccessState = document.body.dataset.billingSuccessOpen
    document.body.style.overflow = "hidden"
    document.body.dataset.billingSuccessOpen = "true"
    continueRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      if (previousSuccessState === undefined) {
        delete document.body.dataset.billingSuccessOpen
      } else {
        document.body.dataset.billingSuccessOpen = previousSuccessState
      }
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [onClose])

  const title = kind === "purchase"
    ? t("manage.planUsage.billing.success.welcome", { plan: planName })
    : kind === "upgrade"
      ? t("manage.planUsage.billing.success.upgraded", { plan: planName })
      : kind === "downgrade"
        ? t("manage.planUsage.billing.success.downgradeScheduled", { plan: planName })
        : t("manage.planUsage.billing.success.billingUpdated")
  const description = kind === "purchase"
    ? t("manage.planUsage.billing.success.purchaseDescription")
    : kind === "upgrade"
      ? t("manage.planUsage.billing.success.upgradeDescription")
      : kind === "downgrade"
        ? effectiveDate && fromPlanName
          ? t("manage.planUsage.billing.success.downgradeDescription", { from: fromPlanName, plan: planName, date: effectiveDate })
          : t("manage.planUsage.billing.success.downgradePendingDescription", { plan: planName })
        : t("manage.planUsage.billing.success.billingDescription")

  return (
    <BillingOverlayPortal>
      <div className="billing-success-experience fixed inset-0 z-[100] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="billing-success-title" aria-describedby="billing-success-description">
        <div className="relative flex min-h-full items-center justify-center p-3 sm:p-5">
          <div className="absolute inset-0 bg-slate-950/35 backdrop-blur-[6px] dark:bg-slate-950/65" aria-hidden="true" />
          <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden" aria-hidden="true">
            {CONFETTI.map((piece) => (
              <span
                key={`${piece.left}-${piece.delay}`}
                className="billing-success-confetti absolute top-[-5vh] h-3 w-2 rounded-[2px] opacity-0 shadow-md"
                style={{ left: piece.left, backgroundColor: piece.color, animationDelay: piece.delay, animationDuration: piece.duration }}
              />
            ))}
          </div>

          <div className="relative z-10 w-full max-w-[24rem] text-center">
            <div className="billing-success-card relative rounded-[1.5rem] border border-white/90 bg-white/95 p-4 shadow-[0_24px_70px_-30px_rgba(30,20,70,0.6)] backdrop-blur-xl dark:border-white/10 dark:bg-[#1c1b29]/95 dark:shadow-[0_24px_70px_-30px_rgba(139,92,246,0.45)] sm:p-5">
            <button type="button" onClick={onClose} aria-label={t("common.close")} className="absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-slate-500 dark:hover:bg-white/10 dark:hover:text-white">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 shadow-[0_10px_24px_-14px_rgba(16,185,129,0.9)] dark:bg-emerald-500/15 dark:text-emerald-300">
              <CircleCheck className="h-7 w-7" strokeWidth={1.7} aria-hidden="true" />
            </div>
            <p className="mt-4 flex items-center justify-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300">
              <Sparkles className="h-3 w-3" aria-hidden="true" /> {isDowngrade ? t("manage.planUsage.billing.success.changeScheduled") : t("manage.planUsage.billing.success.paymentSuccessful")}
            </p>
            <h2 id="billing-success-title" className="mt-2 text-xl font-bold tracking-tight text-slate-950 dark:text-white sm:text-2xl">{title}</h2>
            <p id="billing-success-description" className="mx-auto mt-2 max-w-md text-xs leading-5 text-slate-600 dark:text-slate-300">{description}</p>

            <div className="mt-4 rounded-xl border border-violet-100 bg-violet-50/70 p-3 text-left dark:border-violet-400/15 dark:bg-violet-500/10">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-violet-700 dark:text-violet-200">{isDowngrade ? t("manage.planUsage.billing.success.scheduledChange") : t("manage.planUsage.billing.success.activePlan")}</span>
                <span className="rounded-full bg-white px-2 py-1 text-[9px] font-bold text-violet-700 shadow-sm dark:bg-white/10 dark:text-violet-200">{isDowngrade ? effectiveDate ? t("manage.planUsage.billing.success.scheduledStartsOn", { date: effectiveDate }) : t("manage.planUsage.billing.success.scheduled") : interval === "year" ? t("manage.planUsage.billing.success.billedAnnually") : t("manage.planUsage.billing.success.billedMonthly")}</span>
              </div>
              <p className="mt-1 flex items-center gap-1.5 text-base font-bold text-slate-950 dark:text-white">{fromPlanName && isDowngrade && <><span>{fromPlanName}</span><ArrowRight className="h-3.5 w-3.5 shrink-0 text-violet-500" aria-hidden="true" /></>}<span>{planName}</span></p>
            </div>

            <div className="mt-4 text-left">
              <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{isDowngrade ? t("manage.planUsage.billing.success.featuresAfterChange") : t("manage.planUsage.billing.success.featuresReady")}</p>
              <div className="mt-2 grid gap-1.5">
                {highlights.map((highlight, index) => (
                  <div key={highlight} className="billing-success-feature flex items-center gap-2 rounded-lg border border-slate-100 bg-white/75 px-2.5 py-2 text-xs font-medium text-slate-700 opacity-0 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200" style={{ animationDelay: `${160 + index * 80}ms` }}>
                    <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-300" aria-hidden="true" />
                    <span>{t(highlight)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-1.5 sm:flex-row">
              <Button ref={continueRef} type="button" onClick={onContinue} className="min-h-10 flex-1 rounded-lg bg-violet-600 px-3 text-sm font-semibold text-white shadow-lg shadow-violet-600/20 transition hover:bg-violet-700 focus-visible:ring-violet-500 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#1c1b29]">
                {t("manage.planUsage.billing.success.continue")}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              <button type="button" onClick={onManageBilling} className="min-h-10 rounded-lg px-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white">
                {t("manage.planUsage.billing.success.manageBilling")}
              </button>
            </div>
            </div>
          </div>
        </div>
      </div>
    </BillingOverlayPortal>
  )
}
