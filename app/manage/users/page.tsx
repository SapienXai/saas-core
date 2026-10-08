import { redirect } from "next/navigation"
import { PRODUCT_CONFIG } from "@/lib/product-config"

export default function UsersCompatibilityPage() {
  redirect(PRODUCT_CONFIG.capabilities.workspaceTeamManagement === false ? PRODUCT_CONFIG.shell?.homePath || "/manage" : "/manage/team")
}
