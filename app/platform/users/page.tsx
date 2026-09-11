import { listPlatformUserRecords } from "@/lib/platform-admin"
import { PlatformUserManagement } from "@/components/platform/platform-user-management"
import { PlatformPageHeader } from "@/components/platform/platform-primitives"
import { ManagePage } from "@/components/manage/manage-responsive"
export const dynamic = "force-dynamic"
export default async function PlatformUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) { const params = await searchParams; const query = typeof params.query === "string" ? params.query : ""; const role = typeof params.role === "string" ? params.role : ""; const status = typeof params.status === "string" ? params.status : ""; const rows = await listPlatformUserRecords({ query, role, status: status === "active" || status === "suspended" || status === "none" ? status : undefined }); return <ManagePage><PlatformPageHeader eyebrow="Platform Control" title="Users" description="Manage identity, platform access and recovery from one focused workspace." /><PlatformUserManagement rows={rows} query={query} role={role} status={status} /></ManagePage> }
