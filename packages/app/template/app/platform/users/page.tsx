import { listPlatformUsers } from "@/lib/platform-admin"
import { PlatformCollection } from "@/components/platform/platform-generic"
export const dynamic = "force-dynamic"
export default async function PlatformUsersPage() { const rows = await listPlatformUsers(); return <PlatformCollection title="Users and access" description="Inspect workspace membership without crossing tenant boundaries." rows={rows} columns={[{ key: "user_id", label: "User" }, { key: "workspace_id", label: "Workspace" }, { key: "role", label: "Role" }, { key: "created_at", label: "Added" }]} /> }
