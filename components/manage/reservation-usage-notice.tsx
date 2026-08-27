"use client"

import Link from "next/link"
import { AlertTriangle, ArrowUpRight, CircleCheck } from "lucide-react"
import { useLanguage } from "@/context/language-context"
import { useManageContext } from "@/context/manage-context"
import { formatNumber } from "@/i18n/format"
import { getPlanNavigationHref } from "@/lib/plan-navigation"

export function ReservationUsageNotice() {
  const { currentWorkspace, ownedWorkspaceId } = useManageContext()
  const { currentLang, getTranslation } = useLanguage()
  const limit = currentWorkspace?.plan?.limits?.reservationsPerPeriod
  const usage = currentWorkspace?.usage?.reservationsCreated

  if (limit === null || limit === undefined || usage === undefined) return null
  const percent = limit > 0 ? Math.round((usage / limit) * 100) : 0
  if (percent < 80) return null

  const reached = usage >= limit
  const urgent = percent >= 90
  const title = reached
    ? getTranslation("manage.common.reservationUsageLimitTitle")
    : urgent
      ? getTranslation("manage.common.reservationUsageWarningTitle")
      : getTranslation("manage.common.reservationUsageTitle")
  const description = reached
    ? getTranslation("manage.common.reservationUsageLimitDescription", { used: formatNumber(usage, currentLang), limit: formatNumber(limit, currentLang) })
      : getTranslation("manage.common.reservationUsageDescription", { used: formatNumber(usage, currentLang), limit: formatNumber(limit, currentLang), percent: String(percent) })
  const planHref = getPlanNavigationHref({
    hash: "#upgrade-plans",
    currentWorkspaceId: currentWorkspace?.id,
    ownedWorkspaceId,
  })

  return (
    <section className={`mb-4 flex items-start gap-3 rounded-2xl border px-4 py-3 shadow-sm ${reached ? "border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-100" : urgent ? "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100" : "border-slate-200 bg-white text-slate-900 dark:border-white/10 dark:bg-white/[0.04] dark:text-white"}`} role="alert">
      {reached || urgent ? <AlertTriangle className={`mt-0.5 h-5 w-5 shrink-0 ${reached ? "text-rose-600 dark:text-rose-300" : "text-amber-600 dark:text-amber-300"}`} aria-hidden="true" /> : <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-violet-600 dark:text-violet-300" aria-hidden="true" />}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-1 text-sm leading-5 opacity-80">{description}</p>
      </div>
      <Link href={planHref} className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition ${reached ? "text-rose-800 hover:bg-rose-100 dark:text-rose-200 dark:hover:bg-rose-300/10" : "text-amber-800 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-300/10"}`}>
        {getTranslation("manage.common.viewPlans")}
        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </section>
  )
}
