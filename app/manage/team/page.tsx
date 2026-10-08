import { redirect } from "next/navigation"
import { getTeamManagementData } from "@/app/manage/team/actions"
import { TeamManagement } from "@/app/manage/team/team-management"
import { isProductCapabilityEnabled, PRODUCT_CONFIG } from "@/lib/product-config"
import { getCurrentUserAccess } from "@/lib/auth-utils"

export const dynamic = "force-dynamic"

export default async function TeamPage() {
  const access = await getCurrentUserAccess()
  if (!isProductCapabilityEnabled("workspaceTeamManagement", access?.platformRole)) redirect(PRODUCT_CONFIG.shell?.homePath || "/manage")
  const result = await getTeamManagementData()
  if (!result.success || !result.data) redirect("/manage")
  return <TeamManagement initialData={result.data} />
}
