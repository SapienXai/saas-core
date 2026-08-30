import type React from "react"
import type { Viewport } from "next"
import { redirect } from "next/navigation"
import { AuthorizationError } from "@/lib/authorization"
import { requirePlatformRole } from "@/lib/platform-authorization"
import { ManageLayoutClient } from "@/app/manage/manage-layout-client"
import { getManagementLayoutData } from "@/app/manage/layout"
import { getPwaIconAssetUrl } from "@/lib/pwa"
import { toInitialContext } from "@/lib/management-layout-data"

export const dynamic = "force-dynamic"

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#020617",
}

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  try {
    await requirePlatformRole()
  } catch (error) {
    if (error instanceof AuthorizationError && error.code === "UNAUTHENTICATED") redirect("/login?redirect=/platform")
    redirect("/app")
  }
  const { context, branding } = await getManagementLayoutData()
  const clientBranding = { ...branding, iconUrl: getPwaIconAssetUrl(branding) }
  return <ManageLayoutClient initialBranding={clientBranding} initialContext={toInitialContext(context)}>{children}</ManageLayoutClient>
}
