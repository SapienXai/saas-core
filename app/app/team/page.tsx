import { redirect } from "next/navigation"
import { PRODUCT_CONFIG } from "@/lib/product-config"

export default function TeamCompatibilityPage() {
  if (PRODUCT_CONFIG.capabilities.workspaceTeamManagement === false) redirect(PRODUCT_CONFIG.shell?.homePath || "/manage")
  redirect("/manage/team")
}
