import type React from "react"
import type { Metadata, Viewport } from "next"
import { getPwaIconAssetUrl, getPwaIconVersion, PWA_FALLBACK_ICON } from "@/lib/pwa"
import { ManageLayoutClient } from "@/app/manage/manage-layout-client"
import { getManagementLayoutData, toInitialContext } from "@/lib/management-layout-data"

export const dynamic = "force-dynamic"

export async function generateMetadata(): Promise<Metadata> {
  const { branding } = await getManagementLayoutData()
  const manifestParams = new URLSearchParams()
  if (branding.workspaceId) manifestParams.set("workspace", branding.workspaceId)
  if (branding.iconUrl !== PWA_FALLBACK_ICON) manifestParams.set("v", getPwaIconVersion(branding))
  const manifestUrl = manifestParams.size
    ? `/manifest.webmanifest?${manifestParams.toString()}`
    : "/manifest.webmanifest"
  return {
    title: {
      default: branding.appName,
      template: `%s | ${branding.appName}`,
    },
    manifest: manifestUrl,
    icons: {
      icon: [{ url: getPwaIconAssetUrl(branding, 512), type: "image/png", sizes: "512x512" }],
      apple: [{ url: getPwaIconAssetUrl(branding, 180), type: "image/png", sizes: "180x180" }],
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: branding.appName,
    },
  }
}

export async function generateViewport(): Promise<Viewport> {
  const { branding } = await getManagementLayoutData()
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: branding.themeColor,
  }
}

export default async function ManageLayout({ children }: { children: React.ReactNode }) {
  const { context, branding } = await getManagementLayoutData()
  const clientBranding = { ...branding, iconUrl: getPwaIconAssetUrl(branding) }
  return <ManageLayoutClient initialBranding={clientBranding} initialContext={toInitialContext(context)}>{children}</ManageLayoutClient>
}
