import { listPlatformPlans } from "@/lib/platform-admin"
import { PlatformCollection } from "@/components/platform/platform-generic"
export const dynamic = "force-dynamic"
export default async function PlatformBillingPage() { const rows = await listPlatformPlans(); return <PlatformCollection title="Billing catalog" description="Review plans, limits, and the entitlements available to workspaces." rows={rows} columns={[{ key: "name", label: "Plan" }, { key: "key", label: "Key" }, { key: "monthly_price_usd_cents", label: "Monthly cents" }, { key: "active", label: "Active" }]} /> }
