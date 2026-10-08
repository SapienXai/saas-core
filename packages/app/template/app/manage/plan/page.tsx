import { Check, CreditCard, Sparkles } from "lucide-react"
import { getPlanUsage } from "./actions"
import { BillingActions, type BillingPresentationConfig, type BillingUsageMetricConfig } from "@/components/manage/billing-actions"
import { ScheduledPlanChangeBanner } from "@/components/manage/scheduled-plan-change-banner"
import { getServerLanguage, translateServer, translateServerMessage } from "@/lib/server-i18n"
import { formatDate } from "@/i18n/format"
import { formatCurrentSubscriptionPrice, resolveCurrentSubscriptionPrice } from "@/lib/billing/presentation"
import { PRODUCT_CONFIG } from "@/lib/product-config"
import { ManageMetricCard, ManageMetricGrid, ManagePage, ManagePageHeader, ManageSurface, ManageUsageMetric } from "@/components/manage/manage-responsive"
import { EntitlementLimitNotice } from "@/components/manage/entitlement-limit-notice"

export const dynamic = "force-dynamic"

type Plan = { key: string; name: string; sort_order: number; active: boolean; features: Record<string, boolean>; limits: Record<string, number | null>; metadata: Record<string, unknown> }
type Entitlements = {
  planKey: string
  planName: string
  pricing: Record<string, { amount: number | null; currency: string }>
  features: Record<string, boolean>
  limits: Record<string, number | null>
  scheduledPlan: { key: string; name: string; pricing: Record<string, { amount: number | null; currency: string }>; effectiveAt: string; limits: Record<string, number | null> } | null
}

type ProductRuntimeConfig = {
  catalog?: {
    plans?: readonly { key: string; name?: string; description?: string; metadata?: Record<string, unknown> }[]
    usageMetrics?: readonly BillingUsageMetricConfig[]
    presentation?: BillingPresentationConfig
    billingPresentation?: BillingPresentationConfig
    billing?: { presentation?: BillingPresentationConfig; supportedIntervals?: readonly string[]; defaultInterval?: string }
    billingPolicy?: { presentation?: BillingPresentationConfig; supportedIntervals?: readonly string[]; defaultInterval?: string }
  }
  billing?: { presentation?: BillingPresentationConfig; supportedIntervals?: readonly string[]; defaultInterval?: string }
  billingPolicy?: { presentation?: BillingPresentationConfig; supportedIntervals?: readonly string[]; defaultInterval?: string }
  billingPresentation?: BillingPresentationConfig
}

function displayKey(key: string, presentation?: BillingPresentationConfig) {
  return presentation?.copy?.[key] || presentation?.copy?.[`feature.${key}`] || presentation?.copy?.[`limit.${key}`] || key.replaceAll(/[._-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2")
}

export default async function PlanUsagePage() {
  const language = await getServerLanguage()
  const result = await getPlanUsage()
  if (!result.success || !result.data) return <div className="p-6 text-sm text-slate-600 dark:text-slate-300">{translateServerMessage(language, result.message || "Plan information could not be loaded.")}</div>

  const { workspace, entitlements, usage, billing, plans, configuredPaidPlans, configuredPrices } = result.data as unknown as {
    workspace: { name: string; slug: string }
    entitlements: Entitlements
    usage: { workspaces: number; users: number; metrics: Record<string, number> }
    billing: any
    plans: Plan[]
    configuredPaidPlans: string[]
    configuredPrices: any[]
  }
  const product = PRODUCT_CONFIG as unknown as ProductRuntimeConfig
  const catalog = product.catalog || {}
  const policy = product.billing || product.billingPolicy || catalog.billing || catalog.billingPolicy || {}
  const configuredPresentation = product.billingPresentation || policy.presentation || catalog.billingPresentation || catalog.presentation
  const catalogPlanCopy = Object.fromEntries((catalog.plans || []).map((plan) => [plan.key, { label: plan.name, description: plan.description, highlights: Array.isArray(plan.metadata?.highlights) ? plan.metadata.highlights.filter((value): value is string => typeof value === "string") : undefined }]))
  const presentation: BillingPresentationConfig | undefined = configuredPresentation || Object.keys(catalogPlanCopy).length ? { ...configuredPresentation, plans: { ...catalogPlanCopy, ...configuredPresentation?.plans } } : undefined
  const usageMetrics = [...(catalog.usageMetrics || [])]
  const supportedIntervals = policy.supportedIntervals || ["month", "year"]
  const defaultInterval = policy.defaultInterval || supportedIntervals[0] || "month"
  const copyText = (key: string, fallback: string) => presentation?.copy?.[key]?.trim() || fallback
  const providerBacked = billing.isProviderBacked
  const currentSubscriptionPrice = resolveCurrentSubscriptionPrice({
    providerBacked,
    billingInterval: billing.billingInterval,
    billingCurrency: billing.billingCurrency,
    currentProviderPriceAmount: billing.currentProviderPriceAmount,
    pricing: entitlements.pricing,
  })
  const currentSubscriptionPriceText = providerBacked && (!currentSubscriptionPrice || currentSubscriptionPrice.source === "unavailable")
    ? translateServer(language, "manage.planUsage.billing.currentPriceUnavailable")
    : formatCurrentSubscriptionPrice(currentSubscriptionPrice, language)
  const currentSubscriptionPriceDetail = currentSubscriptionPriceText == null
    ? copyText("pricingLabel", "Product pricing")
    : providerBacked && (!currentSubscriptionPrice || currentSubscriptionPrice.source === "unavailable")
      ? currentSubscriptionPriceText
      : `${currentSubscriptionPriceText} / ${translateServer(language, currentSubscriptionPrice?.interval === "year" ? "manage.planUsage.billing.annual" : "manage.planUsage.billing.monthly")}`
  const hasLimit = (key: string) => Object.prototype.hasOwnProperty.call(entitlements.limits, key)
  const usageMetricLabel = (key: string) => key === "core.workspaces"
    ? copyText("workspacesLabel", translateServer(language, "manage.planUsage.billing.workspaces"))
    : key === "core.members"
      ? copyText("teamMembersLabel", translateServer(language, "manage.planUsage.billing.teamMembers"))
      : usageMetrics.find((metric) => metric.key === key)?.name || displayKey(key, presentation)
  const usageKeys = [...new Set([
    ...usageMetrics.map((metric) => metric.key),
    ...Object.keys(entitlements.limits).filter((key) => !key.startsWith("core.")),
    ...Object.keys(usage.metrics).filter((key) => !key.startsWith("core.")),
  ])]
  const usageRows = [
    { key: "core.workspaces", label: usageMetricLabel("core.workspaces"), value: usage.workspaces, limit: hasLimit("core.workspaces") ? entitlements.limits["core.workspaces"] : undefined },
    { key: "core.members", label: usageMetricLabel("core.members"), value: usage.users, limit: hasLimit("core.members") ? entitlements.limits["core.members"] : undefined },
    ...usageKeys.map((key) => ({ key, label: usageMetricLabel(key), value: usage.metrics[key] ?? undefined, limit: hasLimit(key) ? entitlements.limits[key] : undefined })),
  ]
  const productRows = usageRows.filter((row) => !row.key.startsWith("core."))
  const productMetric = productRows[0]
  const activeStatus = billing.providerStatus || copyText("activeStatus", "Active")
  const throughLabel = billing.currentPeriodEnd ? `${copyText("throughLabel", "Through")} ${formatDate(billing.currentPeriodEnd, language, { dateStyle: "medium" })}` : copyText("workspaceAccess", "Workspace access")
  const memberLimit = usageRows.find((row) => row.key === "core.members")?.limit
  const currentPlanOrder = plans.find((plan) => plan.key === entitlements.planKey)?.sort_order ?? Number.MAX_SAFE_INTEGER
  const nextPlanFor = (row: typeof usageRows[number]) => {
    if (typeof row.value !== "number") return undefined
    return plans
      .filter((plan) => plan.sort_order > currentPlanOrder && Object.prototype.hasOwnProperty.call(plan.limits, row.key))
      .sort((a, b) => a.sort_order - b.sort_order)
      .find((plan) => {
        const limit = plan.limits[row.key]
        return limit === null || typeof limit === "number" && limit > row.value!
      })
  }
  const reachedRows = usageRows.filter((row) => typeof row.limit === "number" && typeof row.value === "number" && row.value >= row.limit)

  return <ManagePage>
    <ManagePageHeader eyebrow={copyText("eyebrow", "Workspace billing")} title={copyText("title", "Plan and usage")} description={`${workspace.name} · ${workspace.slug}`} />
    {entitlements.scheduledPlan && entitlements.scheduledPlan.key !== entitlements.planKey && <ScheduledPlanChangeBanner currentPlanName={entitlements.planName} targetPlanName={entitlements.scheduledPlan.name} effectiveAt={entitlements.scheduledPlan.effectiveAt} canManage={Boolean(billing.canManage)} />}
    {entitlements.scheduledPlan?.key === entitlements.planKey && billing.scheduledPlanInterval && billing.scheduledPlanInterval !== billing.billingInterval && <ScheduledPlanChangeBanner changeKind="billing-cycle" currentPlanName={translateServer(language, billing.billingInterval === "year" ? "manage.planUsage.billing.annual" : "manage.planUsage.billing.monthly")} targetPlanName={translateServer(language, billing.scheduledPlanInterval === "year" ? "manage.planUsage.billing.annual" : "manage.planUsage.billing.monthly")} effectiveAt={billing.scheduledPlanAt} canManage={Boolean(billing.canManage)} />}
    <ManageMetricGrid>
      <ManageMetricCard label={copyText("currentPlanLabel", "Current plan")} value={entitlements.planName} detail={currentSubscriptionPriceDetail} icon={Sparkles} />
      <ManageMetricCard label={copyText("billingLabel", translateServer(language, "manage.planUsage.billing.billingDetails"))} value={activeStatus} detail={throughLabel} icon={CreditCard} />
      <ManageMetricCard label={copyText("membersLabel", translateServer(language, "manage.planUsage.billing.teamMembers"))} value={usage.users} detail={memberLimit === undefined ? "—" : memberLimit === null ? "Unlimited" : `${copyText("ofLabel", "of")} ${memberLimit}`} />
      {productMetric && <ManageMetricCard label={productMetric.label} value={productMetric.value ?? "—"} detail={productMetric.limit === undefined ? "—" : productMetric.limit === null ? "Unlimited" : `${copyText("ofLabel", "of")} ${productMetric.limit}`} />}
    </ManageMetricGrid>
    <ManageSurface className="overflow-hidden"><div className="flex items-center gap-2 border-b border-slate-100 px-3.5 py-3 dark:border-white/10 sm:px-4"><Sparkles className="h-4 w-4 text-violet-600 dark:text-violet-300" /><h2 className="text-sm font-semibold text-slate-950 dark:text-white">{copyText("includedFeaturesTitle", "Included features")}</h2></div><div className="grid gap-2 p-3.5 sm:grid-cols-2 sm:p-4">{Object.entries(entitlements.features).filter(([, enabled]) => enabled).map(([key]) => <div key={key} className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200"><Check className="h-3.5 w-3.5 text-emerald-600" />{displayKey(key, presentation)}</div>)}</div><div className={`grid border-t border-slate-100 dark:border-white/10 ${usageRows.length > 3 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3"}`}>{usageRows.map((row) => <ManageUsageMetric key={row.key} label={row.label} value={row.value} limit={row.limit} />)}</div></ManageSurface>
    {reachedRows.length > 0 && <section className="space-y-2" aria-label={copyText("limitReachedLabel", "Plan limits")}>{reachedRows.map((row) => <EntitlementLimitNotice key={row.key} capability={row.key} label={row.label} current={row.value} limit={row.limit} requiredPlan={nextPlanFor(row)?.name} />)}</section>}
    <BillingActions currentPlan={entitlements.planKey} billing={billing} plans={plans} configuredPaidPlans={configuredPaidPlans} configuredPrices={configuredPrices} presentation={presentation} usageMetrics={usageMetrics} supportedIntervals={supportedIntervals} defaultInterval={defaultInterval} />
  </ManagePage>
}
