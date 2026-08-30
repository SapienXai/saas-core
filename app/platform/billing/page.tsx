import { listPlatformPlans } from "@/lib/platform-admin"
import { PlatformCollection } from "@/components/platform/platform-generic"
import { requirePlatformBillingAccess } from "@/lib/platform-authorization"
export const dynamic = "force-dynamic"
export default async function PlatformBillingPage() { await requirePlatformBillingAccess(); const rows = await listPlatformPlans(); return <PlatformCollection title="Billing catalog" description="Review product-defined plans, limits, and entitlements available to workspaces." rows={rows} columns={[{ key: "name", label: "Plan" }, { key: "key", label: "Key" }, { key: "limits", label: "Limits" }, { key: "active", label: "Active" }]} /> }
