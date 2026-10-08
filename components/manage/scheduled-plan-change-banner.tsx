"use client"

import { useState, useTransition } from "react"
import { ArrowRight, CalendarClock, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useLanguage } from "@/context/language-context"
import { formatDate as formatLocalizedDate } from "@/i18n/format"
import { useRouter } from "next/navigation"
import { undoPlanChange } from "@/app/manage/plan/actions"

type ScheduledPlanChangeBannerProps = {
  currentPlanName: string
  targetPlanName: string
  effectiveAt: string | null
  canManage: boolean
  changeKind?: "plan" | "billing-cycle"
}

export function ScheduledPlanChangeBanner({ currentPlanName, targetPlanName, effectiveAt, canManage, changeKind = "plan" }: ScheduledPlanChangeBannerProps) {
  const { currentLang, getTranslation, translateMessage } = useLanguage()
  const t = getTranslation
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const effectiveDate = effectiveAt ? formatLocalizedDate(effectiveAt, currentLang, { dateStyle: "medium", timeStyle: "short" }) : null

  const undo = () => {
    startTransition(async () => {
      setMessage(null)
      const result = await undoPlanChange(`undo-${crypto.randomUUID()}`)
      if (!result.success) {
        setMessage(translateMessage(result.message || t("manage.planUsage.billing.actionFailed")))
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="mx-5 mb-5 overflow-hidden rounded-2xl border border-violet-200 bg-violet-50/80 shadow-[0_14px_34px_-26px_rgba(109,40,217,0.65)] dark:border-violet-400/25 dark:bg-violet-500/10 sm:mx-6" role="status" aria-live="polite">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white shadow-lg shadow-violet-600/20 dark:bg-violet-500">
            <CalendarClock className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-700 dark:text-violet-200">{changeKind === "billing-cycle" ? t("manage.planUsage.billing.billingCycleChangeLabel") : t("manage.planUsage.billing.scheduledChange")}</p>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-base font-bold tracking-tight text-violet-950 dark:text-white">
              <span>{currentPlanName}</span>
              <ArrowRight className="h-4 w-4 text-violet-500" aria-hidden="true" />
              <span>{targetPlanName}</span>
            </p>
            <p className="mt-1 text-xs leading-5 text-violet-800/80 dark:text-violet-100/75">
              {effectiveDate ? <>{changeKind === "billing-cycle" ? <>{t("manage.planUsage.billing.billingCycleChangeScheduled", { date: effectiveDate })} {t("manage.planUsage.billing.billingCycleChangeScheduledDescription")}</> : t("manage.planUsage.billing.scheduledPlanStarts", { date: effectiveDate, plan: targetPlanName })} <time dateTime={effectiveAt || undefined} className="sr-only">{effectiveDate}</time></> : t("manage.planUsage.billing.scheduledPlanPending")}
            </p>
            {message && <p className="mt-2 text-xs font-semibold text-rose-700 dark:text-rose-300" role="alert">{message}</p>}
          </div>
        </div>
        {canManage && <Button type="button" onClick={undo} loading={pending} className="min-h-10 w-full shrink-0 rounded-xl border border-violet-300 bg-white px-3.5 py-2 text-sm font-semibold text-violet-800 shadow-sm hover:bg-violet-100 dark:border-violet-300/30 dark:bg-white/10 dark:text-violet-100 dark:hover:bg-violet-500/20 sm:w-auto"><RotateCcw className="h-3.5 w-3.5" />{t("manage.planUsage.billing.undoChange")}</Button>}
      </div>
    </div>
  )
}
