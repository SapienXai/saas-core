import { listPlatformDomains } from "@/lib/platform-admin"
import { PlatformCollection } from "@/components/platform/platform-generic"
export const dynamic = "force-dynamic"
export default async function PlatformDomainsPage() { const rows = await listPlatformDomains(); return <PlatformCollection title="Domains" description="Reconcile connected workspace domains and provider state." rows={rows} columns={[{ key: "hostname", label: "Hostname" }, { key: "workspace_id", label: "Workspace" }, { key: "status", label: "Status" }, { key: "last_checked_at", label: "Last checked" }]} /> }
