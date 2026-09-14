import { listPlatformPlans } from "@/lib/platform-admin"
import { PlatformPlanManagement } from "@/components/platform/platform-plan-management"
import { requirePlatformBillingAccess } from "@/lib/platform-authorization"
import { PRODUCT_CONFIG } from "@/lib/product-config"
import { ManagePage } from "@/components/manage/manage-responsive"
import { PlatformPageHeader } from "@/components/platform/platform-primitives"

export const dynamic = "force-dynamic"

export default async function PlatformBillingPage() {
  await requirePlatformBillingAccess()
  const rows = await listPlatformPlans()
  const product = PRODUCT_CONFIG as typeof PRODUCT_CONFIG & {
    billingPresentation?: { copy?: Readonly<Record<string, string>> }
    billing?: { presentation?: { copy?: Readonly<Record<string, string>> } }
    billingPolicy?: { presentation?: { copy?: Readonly<Record<string, string>> } }
    catalog?: { presentation?: { copy?: Readonly<Record<string, string>> }; billingPresentation?: { copy?: Readonly<Record<string, string>> } }
  }
  const copy = product.billingPresentation?.copy || product.billing?.presentation?.copy || product.billingPolicy?.presentation?.copy || product.catalog?.billingPresentation?.copy || product.catalog?.presentation?.copy || {}
  const copyText = (key: string, fallback: string) => copy[key]?.trim() || fallback
  return <ManagePage><PlatformPageHeader eyebrow={copyText("eyebrow", "Platform billing")} title={copyText("platformTitle", "Billing catalog")} description={copyText("platformDescription", "Review and safely manage product-defined plans, limits, and entitlements available to workspaces.")} /><PlatformPlanManagement rows={rows} /></ManagePage>
}
