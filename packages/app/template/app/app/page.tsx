import { redirect } from "next/navigation"
import CoreWorkspaceDashboard from "@/app/manage/page"
import { getProductHomePath } from "@/lib/product-shell"

export default function AppHome() {
  const homePath = getProductHomePath()
  if (homePath !== "/app") redirect(homePath)
  return <CoreWorkspaceDashboard />
}
