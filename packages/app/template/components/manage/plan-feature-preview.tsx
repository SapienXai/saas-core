"use client"

import { ArrowUpRight, Check, Sparkles } from "lucide-react"
import { useLanguage } from "@/context/language-context"
import { useManageContext } from "@/context/manage-context"
import { isProductCapabilityEnabled } from "@/lib/product-config"
import type { BillingPresentationConfig, BillingUsageMetricConfig } from "@/components/manage/billing-actions"

type PlanFeaturePreviewPlan = {
  key: string
  name: string
  features: Record<string, boolean>
  limits?: Record<string, number | null>
}

type Props = {
  plan: PlanFeaturePreviewPlan | null
  currentPlanKey: string
  presentation?: BillingPresentationConfig
  usageMetrics?: BillingUsageMetricConfig[]
}

function displayKey(key: string, presentation?: BillingPresentationConfig) {
  return presentation?.copy?.[key] || presentation?.copy?.[`feature.${key}`] || presentation?.copy?.[`limit.${key}`] || key.replaceAll(/[._-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2")
}

/** SaaS Core-derived plan capability preview, with product-neutral feature keys. */
export function PlanFeaturePreview({ plan, currentPlanKey, presentation, usageMetrics = [] }: Props) {
  const { getTranslation } = useLanguage()
  const { platformRole } = useManageContext()
  const showTeamManagement = isProductCapabilityEnabled("workspaceTeamManagement", platformRole)
  const showWorkspaceManagement = isProductCapabilityEnabled("workspaceManagement", platformRole)
  const t = getTranslation
  const features = plan?.features || {}
  const limits = plan?.limits || {}
  const orderedFeatureKeys = presentation?.featureKeys?.length ? presentation.featureKeys.filter((key) => key in features) : Object.keys(features)
  const enabledFeatures = orderedFeatureKeys.filter((key) => features[key])
  const disabledFeatures = orderedFeatureKeys.filter((key) => !features[key])
  const requestedLimitKeys = presentation?.limitKeys?.length ? presentation.limitKeys : Object.keys(limits)
  const orderedLimitKeys = requestedLimitKeys.filter((key) =>
    key in limits &&
    (showTeamManagement || key !== "core.members") &&
    (showWorkspaceManagement || key !== "core.workspaces")
  )
  const usageMetricName = (key: string) => usageMetrics.find((metric) => metric.key === key)?.name || displayKey(key, presentation)
  const copyText = (key: string, fallback: string) => presentation?.copy?.[key]?.trim() || fallback
  const formatLimit = (value: number | null | undefined) => value === null ? "∞" : value === undefined ? "—" : value.toLocaleString()
  const planLabel = plan ? presentation?.plans?.[plan.key]?.label?.trim() || plan.name : "—"

  return (
    <section id="plan-preview" className="manage-plan-card scroll-mt-6 rounded-[1.5rem] border border-violet-200/80 bg-white p-4 shadow-sm ring-1 ring-violet-100/70 dark:border-violet-400/20 dark:bg-white/[0.04] dark:ring-violet-400/10 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300">{t("manage.planUsage.planPreview")}</p>
            <h2 className="mt-0.5 truncate text-base font-bold tracking-tight text-slate-950 dark:text-white">{t("manage.planUsage.includedIn", { plan: planLabel })}</h2>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">{enabledFeatures.length} {copyText("includedLabel", t("manage.planUsage.included"))}</span>
      </div>

      <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {enabledFeatures.map((key) => (
          <div key={key} className="flex min-w-0 items-center gap-2 rounded-xl bg-emerald-50/80 px-3 py-2 text-xs font-medium text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
            <Check className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{displayKey(key, presentation)}</span>
          </div>
        ))}
        {disabledFeatures.map((key) => (
          <div key={key} className="flex min-w-0 items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-400 dark:bg-white/[0.03] dark:text-slate-500">
            <Check className="h-3.5 w-3.5 shrink-0 opacity-25" />
            <span className="truncate">{displayKey(key, presentation)}</span>
          </div>
        ))}
      </div>

      {orderedLimitKeys.length > 0 && <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {orderedLimitKeys.map((key) => (
          <div key={key} className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-xs dark:bg-white/[0.03]">
            <span className="min-w-0 truncate text-slate-500 dark:text-slate-400">{usageMetricName(key)}</span>
            <span className="shrink-0 font-bold tabular-nums text-slate-800 dark:text-slate-200">{formatLimit(limits[key])}</span>
          </div>
        ))}
      </div>}

      {plan?.key && plan.key !== currentPlanKey && (
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
          <ArrowUpRight className="h-3.5 w-3.5 text-violet-500" />
          {t("manage.planUsage.selectPackage")}
        </p>
      )}
    </section>
  )
}
