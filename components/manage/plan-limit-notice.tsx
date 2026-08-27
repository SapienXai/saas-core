"use client"

import Link from "next/link"
import { AlertTriangle, ArrowUpRight, X } from "lucide-react"
import { useLanguage } from "@/context/language-context"
import { useManageContext } from "@/context/manage-context"
import { formatDate as formatLocalizedDate } from "@/i18n/format"
import { getPlanNavigationHref } from "@/lib/plan-navigation"
import { useEffect, useState } from "react"

const PLAN_LIMIT_NOTICE_DISMISSAL_PREFIX = "reservevia:manage:plan-limit-notice-dismissed"

function formatEffectiveDate(value: string, language: Parameters<typeof formatLocalizedDate>[1]) {
  const trimmed = value.trim()
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T12:00:00` : trimmed
  const parsed = new Date(normalized)

  return Number.isNaN(parsed.getTime())
    ? trimmed
    : formatLocalizedDate(parsed, language, { dateStyle: "medium" })
}

export function ManagePlanLimitNotice() {
  const { currentWorkspace, ownedWorkspaceId } = useManageContext()
  const { currentLang, getTranslation } = useLanguage()
  const [dismissedNoticeKey, setDismissedNoticeKey] = useState<string | null>(null)
  const plan = currentWorkspace?.plan
  const scheduledPlan = plan?.scheduledPlan
  const restaurantCount = plan?.restaurantCount || 0
  const scheduledLimit = scheduledPlan?.limits.restaurants
  const noticeKey = currentWorkspace?.id && scheduledPlan
    ? [PLAN_LIMIT_NOTICE_DISMISSAL_PREFIX, currentWorkspace.id, scheduledPlan.key, scheduledPlan.effectiveAt, scheduledLimit].join(":")
    : null

  useEffect(() => {
    if (!noticeKey) {
      setDismissedNoticeKey(null)
      return
    }

    try {
      setDismissedNoticeKey(window.localStorage.getItem(noticeKey) === "1" ? noticeKey : null)
    } catch {
      setDismissedNoticeKey(null)
    }
  }, [noticeKey])

  if (!scheduledPlan || scheduledLimit === null || scheduledLimit === undefined || restaurantCount <= scheduledLimit || dismissedNoticeKey === noticeKey) return null

  const effectiveDate = formatEffectiveDate(scheduledPlan.effectiveAt, currentLang)
  const affectedCount = restaurantCount - scheduledLimit
  const planHref = getPlanNavigationHref({
    currentWorkspaceId: currentWorkspace?.id,
    ownedWorkspaceId,
  })

  function dismissNotice() {
    if (!noticeKey) return
    setDismissedNoticeKey(noticeKey)
    try {
      window.localStorage.setItem(noticeKey, "1")
    } catch {
      // The alert is still dismissed for this render when storage is unavailable.
    }
  }

  return (
    <section className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950 shadow-sm dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100" role="alert">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{getTranslation("manage.common.planLimitWarningTitle")}</p>
        <p className="mt-1 text-sm leading-5 text-amber-900/80 dark:text-amber-100/80">
          {getTranslation("manage.common.planLimitWarningDescription", {
            count: String(affectedCount),
            plan: scheduledPlan.name,
            date: effectiveDate,
          })}
        </p>
      </div>
      <Link href={planHref} className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-amber-800 transition hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-300/10">
        {getTranslation("manage.common.viewPlans")}
        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
      <button type="button" onClick={dismissNotice} aria-label={getTranslation("common.close")} title={getTranslation("common.close")} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-amber-700 transition hover:bg-amber-100 hover:text-amber-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:text-amber-200 dark:hover:bg-amber-300/10 dark:hover:text-amber-50">
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </section>
  )
}
