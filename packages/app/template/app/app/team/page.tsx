import { redirect } from "next/navigation"
import { getCurrentUserAccess } from "@/lib/auth-utils"
import { isProductCapabilityEnabled, PRODUCT_CONFIG } from "@/lib/product-config"

export default async function TeamCompatibilityPage() {
  const access = await getCurrentUserAccess()
  if (!isProductCapabilityEnabled("workspaceTeamManagement", access?.platformRole)) redirect(PRODUCT_CONFIG.shell?.homePath || "/manage")
  redirect("/manage/team")
}
