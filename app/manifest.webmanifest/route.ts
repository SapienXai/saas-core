import { NextResponse } from "next/server"
import { classifyHostname, getRequestHostname } from "@/lib/domains/hostname"
import { getManagementContext } from "@/lib/management-context"
import { getEffectivePwaBranding, getGenericPwaBranding, getPwaIconAssetUrl, getPublicPwaBranding, PWA_FALLBACK_ICON, PWA_FALLBACK_ICON_192 } from "@/lib/pwa"
import { getPwaIconMimeType } from "@/lib/pwa-icon"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(request: Request) {
  const classification = classifyHostname(getRequestHostname(request) || "")
  if (!["PLATFORM_APP", "LOCAL_DEVELOPMENT", "VERCEL_PREVIEW"].includes(classification.kind)) {
    return new NextResponse("Not Found", { status: 404 })
  }

  const context = await getManagementContext()
  const requestedWorkspaceId = new URL(request.url).searchParams.get("workspace")
  const requestedWorkspace = requestedWorkspaceId
    ? context?.memberships.find((membership) => membership.workspaceId === requestedWorkspaceId)
    : undefined
  const workspaceId = requestedWorkspace?.workspaceId || context?.currentWorkspace?.id || null
  const publicBranding = !context && requestedWorkspaceId
    ? await getPublicPwaBranding(requestedWorkspaceId)
    : null
  const branding = publicBranding || (workspaceId
    ? await getEffectivePwaBranding(workspaceId)
    : getGenericPwaBranding())
  const resolvedWorkspaceId = branding.workspaceId || workspaceId
  const fallbackIcons = [
    { src: PWA_FALLBACK_ICON_192, sizes: "192x192", type: getPwaIconMimeType(PWA_FALLBACK_ICON_192), purpose: "any maskable" },
    { src: PWA_FALLBACK_ICON, sizes: "512x512", type: getPwaIconMimeType(PWA_FALLBACK_ICON), purpose: "any maskable" },
  ]
  const icons = branding.iconUrl === PWA_FALLBACK_ICON
    ? fallbackIcons
    : [
        { src: getPwaIconAssetUrl(branding, 192), sizes: "192x192", type: "image/png", purpose: "any maskable" },
        { src: getPwaIconAssetUrl(branding, 512), sizes: "512x512", type: "image/png", purpose: "any maskable" },
      ]
  const startParams = new URLSearchParams({ pwa: "1" })
  if (resolvedWorkspaceId) startParams.set("workspace", resolvedWorkspaceId)

  return NextResponse.json({
    name: branding.appName,
    short_name: branding.shortName,
    description: "Workspace management",
    id: resolvedWorkspaceId
      ? `/pwa/${resolvedWorkspaceId}`
      : "/pwa/saas-core",
    start_url: `/app?${startParams.toString()}`,
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone"],
    theme_color: branding.themeColor,
    background_color: branding.backgroundColor,
    icons,
    prefer_related_applications: false,
  }, {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "private, no-store, max-age=0",
    },
  })
}
