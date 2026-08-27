import { listPlatformWorkspaces } from "@/lib/platform-admin"
import { PlatformCollection } from "@/components/platform/platform-generic"
export const dynamic = "force-dynamic"
export default async function PlatformWorkspacesPage() { const rows = await listPlatformWorkspaces(); return <PlatformCollection title="Workspaces" description="Review every workspace and its current lifecycle state." rows={rows} columns={[{ key: "name", label: "Workspace" }, { key: "slug", label: "Slug" }, { key: "status", label: "Status" }, { key: "created_at", label: "Created" }]} /> }
