import { listPlatformAuditLogs } from "@/lib/platform-admin"
import { PlatformCollection } from "@/components/platform/platform-generic"
export const dynamic = "force-dynamic"
export default async function PlatformAuditPage() { const rows = await listPlatformAuditLogs(); return <PlatformCollection title="Audit log" description="Trace sensitive platform operations and their reasons." rows={rows} columns={[{ key: "created_at", label: "Time" }, { key: "action", label: "Action" }, { key: "entity_type", label: "Entity" }, { key: "reason", label: "Reason" }]} /> }
