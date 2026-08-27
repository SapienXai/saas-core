import { listPlatformPlans } from "@/lib/platform-admin"
import { PlatformCollection } from "@/components/platform/platform-generic"
export const dynamic = "force-dynamic"
export default async function PlatformOverridesPage() { const rows = await listPlatformPlans(); return <PlatformCollection title="Overrides" description="Review the plan catalog used for controlled workspace overrides." rows={rows} columns={[{ key: "key", label: "Plan" }, { key: "name", label: "Name" }, { key: "workspace_limit", label: "Workspace limit" }, { key: "user_limit", label: "User limit" }]} /> }
