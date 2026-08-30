import { Check, CreditCard, Sparkles } from "lucide-react"
import { getPlanUsage } from "./actions"
import { PaddleBillingActions } from "@/components/manage/paddle-billing-actions"
import { getServerLanguage, translateServerMessage } from "@/lib/server-i18n"
import { formatCurrency } from "@/i18n/format"
import { ManageMetricCard, ManageMetricGrid, ManagePage, ManagePageHeader, ManageSurface, ManageUsageMetric } from "@/components/manage/manage-responsive"

export const dynamic = "force-dynamic"
type Plan = { key: string; name: string; sort_order: number; active: boolean; features: Record<string, boolean>; limits: Record<string, number | null>; metadata: Record<string, unknown> }

export default async function PlanUsagePage() {
  const language = await getServerLanguage(); const result = await getPlanUsage()
  if (!result.success || !result.data) return <div className="p-6 text-sm text-slate-600 dark:text-slate-300">{translateServerMessage(language, result.message || "Plan information could not be loaded.")}</div>
  const { workspace, entitlements, usage, billing, plans, configuredPaidPlans, configuredPrices } = result.data as unknown as { workspace: { name: string; slug: string }; entitlements: { planKey: string; planName: string; pricing: Record<string, { amount: number | null; currency: string }>; features: Record<string, boolean>; limits: Record<string, number | null> }; usage: { workspaces: number; users: number; metrics: Record<string, number> }; billing: any; plans: Plan[]; configuredPaidPlans: string[]; configuredPrices: any[] }
  const monthlyPrice = entitlements.pricing.month?.amount
  const productMetric = Object.keys(entitlements.limits).find((key) => !key.startsWith("core."))
  const productMetricLabel = productMetric ? productMetric.replaceAll(/[._-]+/g, " ") : "Product usage"
  const productMetricValue = productMetric ? usage.metrics[productMetric] || 0 : 0
  const productMetricLimit = productMetric ? entitlements.limits[productMetric] ?? null : null
  const displayFeature = (key: string) => key.replaceAll(/[._-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2")
  return <ManagePage>
    <ManagePageHeader eyebrow="Workspace billing" title="Plan and usage" description={`${workspace.name} · ${workspace.slug}`} />
    <ManageMetricGrid>
      <ManageMetricCard label="Current plan" value={entitlements.planName} detail={monthlyPrice == null ? "Product pricing" : `${formatCurrency(monthlyPrice, language)} / month`} icon={Sparkles} />
      <ManageMetricCard label="Billing" value={billing.providerStatus || "Active"} detail={billing.currentPeriodEnd ? `Through ${new Date(billing.currentPeriodEnd).toLocaleDateString()}` : "Workspace access"} icon={CreditCard} />
      <ManageMetricCard label="Members" value={usage.users} detail={entitlements.limits["core.members"] == null ? "Unlimited" : `of ${entitlements.limits["core.members"]}`} />
      <ManageMetricCard label={productMetricLabel} value={productMetricValue} detail={productMetricLimit == null ? "Unlimited" : `of ${productMetricLimit}`} />
    </ManageMetricGrid>
    <ManageSurface className="overflow-hidden"><div className="flex items-center gap-2 border-b border-slate-100 px-3.5 py-3 dark:border-white/10 sm:px-4"><Sparkles className="h-4 w-4 text-violet-600 dark:text-violet-300" /><h2 className="text-sm font-semibold text-slate-950 dark:text-white">Included features</h2></div><div className="grid gap-2 p-3.5 sm:grid-cols-2 sm:p-4">{Object.entries(entitlements.features).filter(([, enabled]) => enabled).map(([key]) => <div key={key} className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200"><Check className="h-3.5 w-3.5 text-emerald-600" />{displayFeature(key)}</div>)}</div><div className="grid border-t border-slate-100 sm:grid-cols-3 dark:border-white/10"><ManageUsageMetric label="Workspaces" value={usage.workspaces} limit={entitlements.limits["core.workspaces"] ?? null} /><ManageUsageMetric label="Team members" value={usage.users} limit={entitlements.limits["core.members"] ?? null} /><ManageUsageMetric label={productMetricLabel} value={productMetricValue} limit={productMetricLimit} /></div></ManageSurface>
    <PaddleBillingActions currentPlan={entitlements.planKey} billing={billing} plans={plans as any} configuredPaidPlans={configuredPaidPlans} configuredPrices={configuredPrices} />
  </ManagePage>
}
