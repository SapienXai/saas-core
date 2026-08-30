import { listPlatformPlans } from "@/lib/platform-admin"
import { PlatformCollection } from "@/components/platform/platform-generic"
import { requirePlatformWriteAccess } from "@/lib/platform-authorization"
export const dynamic = "force-dynamic"
export default async function PlatformOverridesPage() { await requirePlatformWriteAccess(); const rows = await listPlatformPlans(); return <PlatformCollection title="Overrides" description="Review the product catalog used for controlled workspace overrides." rows={rows} columns={[{ key: "key", label: "Plan" }, { key: "name", label: "Name" }, { key: "limits", label: "Limits" }, { key: "active", label: "Active" }]} /> }
