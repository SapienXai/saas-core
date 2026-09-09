import { Check, CreditCard, Sparkles } from "lucide-react"
import { getPlanUsage } from "./actions"
import { PaddleBillingActions, type BillingPresentationConfig, type BillingUsageMetricConfig } from "@/components/manage/paddle-billing-actions"
import { ScheduledPlanChangeBanner } from "@/components/manage/scheduled-plan-change-banner"
import { getServerLanguage, translateServer, translateServerMessage } from "@/lib/server-i18n"
import { formatCurrency, formatDate } from "@/i18n/format"
import { PRODUCT_CONFIG } from "@/lib/product-config"
import { ManageMetricCard, ManageMetricGrid, ManagePage, ManagePageHeader, ManageSurface, ManageUsageMetric } from "@/components/manage/manage-responsive"

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
  const monthlyPrice = entitlements.pricing.month?.amount
  const productMetric = Object.keys(entitlements.limits).find((key) => !key.startsWith("core."))
  const productMetricLabel = productMetric ? usageMetrics.find((metric) => metric.key === productMetric)?.name || displayKey(productMetric, presentation) : copyText("productUsageLabel", "Product usage")
  const productMetricValue = productMetric ? usage.metrics[productMetric] || 0 : 0
  const productMetricLimit = productMetric ? entitlements.limits[productMetric] ?? null : null
  const activeStatus = billing.providerStatus || copyText("activeStatus", "Active")
  const throughLabel = billing.currentPeriodEnd ? `${copyText("throughLabel", "Through")} ${formatDate(billing.currentPeriodEnd, language, { dateStyle: "medium" })}` : copyText("workspaceAccess", "Workspace access")
  const memberLimit = entitlements.limits["core.members"]

  return <ManagePage>
    <ManagePageHeader eyebrow={copyText("eyebrow", "Workspace billing")} title={copyText("title", "Plan and usage")} description={`${workspace.name} · ${workspace.slug}`} />
    {entitlements.scheduledPlan && <ScheduledPlanChangeBanner currentPlanName={entitlements.planName} targetPlanName={entitlements.scheduledPlan.name} effectiveAt={entitlements.scheduledPlan.effectiveAt} canManage={Boolean(billing.canManage)} />}
    <ManageMetricGrid>
      <ManageMetricCard label={copyText("currentPlanLabel", "Current plan")} value={entitlements.planName} detail={monthlyPrice == null ? copyText("pricingLabel", "Product pricing") : `${formatCurrency(monthlyPrice, language)} / ${translateServer(language, "manage.planUsage.billing.monthly")}`} icon={Sparkles} />
      <ManageMetricCard label={copyText("billingLabel", translateServer(language, "manage.planUsage.billing.billingDetails"))} value={activeStatus} detail={throughLabel} icon={CreditCard} />
      <ManageMetricCard label={copyText("membersLabel", translateServer(language, "manage.planUsage.billing.teamMembers"))} value={usage.users} detail={memberLimit == null ? "Unlimited" : `${copyText("ofLabel", "of")} ${memberLimit}`} />
      <ManageMetricCard label={productMetricLabel} value={productMetricValue} detail={productMetricLimit == null ? "Unlimited" : `${copyText("ofLabel", "of")} ${productMetricLimit}`} />
    </ManageMetricGrid>
    <ManageSurface className="overflow-hidden"><div className="flex items-center gap-2 border-b border-slate-100 px-3.5 py-3 dark:border-white/10 sm:px-4"><Sparkles className="h-4 w-4 text-violet-600 dark:text-violet-300" /><h2 className="text-sm font-semibold text-slate-950 dark:text-white">{copyText("includedFeaturesTitle", "Included features")}</h2></div><div className="grid gap-2 p-3.5 sm:grid-cols-2 sm:p-4">{Object.entries(entitlements.features).filter(([, enabled]) => enabled).map(([key]) => <div key={key} className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200"><Check className="h-3.5 w-3.5 text-emerald-600" />{displayKey(key, presentation)}</div>)}</div><div className="grid border-t border-slate-100 sm:grid-cols-3 dark:border-white/10"><ManageUsageMetric label={copyText("workspacesLabel", translateServer(language, "manage.planUsage.billing.workspaces"))} value={usage.workspaces} limit={entitlements.limits["core.workspaces"] ?? null} /><ManageUsageMetric label={copyText("teamMembersLabel", translateServer(language, "manage.planUsage.billing.teamMembers"))} value={usage.users} limit={memberLimit ?? null} /><ManageUsageMetric label={productMetricLabel} value={productMetricValue} limit={productMetricLimit} /></div></ManageSurface>
    <PaddleBillingActions currentPlan={entitlements.planKey} billing={billing} plans={plans} configuredPaidPlans={configuredPaidPlans} configuredPrices={configuredPrices} presentation={presentation} usageMetrics={usageMetrics} supportedIntervals={supportedIntervals} defaultInterval={defaultInterval} />
  </ManagePage>
}
