import { redirect } from "next/navigation"
import { getTeamManagementData } from "@/app/manage/team/actions"
import { TeamManagement } from "@/app/manage/team/team-management"
import { PRODUCT_CONFIG } from "@/lib/product-config"

export const dynamic = "force-dynamic"

export default async function TeamPage() {
  if (PRODUCT_CONFIG.capabilities.workspaceTeamManagement === false) redirect(PRODUCT_CONFIG.shell?.homePath || "/manage")
  const result = await getTeamManagementData()
  if (!result.success || !result.data) redirect("/manage")
  return <TeamManagement initialData={result.data} />
}
