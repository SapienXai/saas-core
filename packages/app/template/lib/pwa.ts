import "server-only"
import { can } from "@/lib/entitlements"
import { createServiceRoleClient } from "@/lib/supabase"
import { getAssetVersion } from "@/lib/asset-version"
import { PRODUCT_CONFIG } from "@/lib/product-config"
import { resolvePwaFallbackIconPath } from "@/lib/pwa-icon"
import { cache } from "react"

export const PWA_FALLBACK_ICON = PRODUCT_CONFIG.iconPath
const optionalProductConfig = PRODUCT_CONFIG as typeof PRODUCT_CONFIG & { iconPath192?: unknown }
export const PWA_FALLBACK_ICON_192 = resolvePwaFallbackIconPath(PWA_FALLBACK_ICON, optionalProductConfig.iconPath192, 192)
export const PWA_DEFAULT_THEME_COLOR = PRODUCT_CONFIG.themeColor
export const PWA_DEFAULT_BACKGROUND_COLOR = "#ffffff"
const PWA_ICON_RENDER_VERSION = "1"
export type EffectivePwaBranding = { workspaceId: string | null; appName: string; shortName: string; iconUrl: string; themeColor: string; backgroundColor: string; customBrandingEnabled: boolean; customIconUrl: string | null; iconVersion: string | null }
type PwaBrandingInput = { workspaceId: string | null; workspaceName?: string | null; settings?: { app_name?: string | null; icon_url?: string | null; theme_color?: string | null; background_color?: string | null } | null; customBrandingEnabled?: boolean }
function shortAppName(value: string) { return value.length > 24 ? `${value.slice(0, 21).trimEnd()}…` : value }
export function getPwaIconAssetUrl(branding: Pick<EffectivePwaBranding, "workspaceId" | "iconUrl"> & { iconVersion?: string | null }, size?: 180 | 192 | 512) {
  if (!branding.workspaceId || branding.iconUrl === PWA_FALLBACK_ICON) return branding.iconUrl
  const params = new URLSearchParams({ workspace: branding.workspaceId }); if (size) params.set("size", String(size)); params.set("v", getPwaIconVersion(branding)); params.set("render", PWA_ICON_RENDER_VERSION); return `/pwa/icon?${params.toString()}`
}
export function getPwaIconVersion(branding: Pick<EffectivePwaBranding, "iconUrl"> & { iconVersion?: string | null }) { return getAssetVersion(branding.iconUrl, branding.iconVersion) }
export function buildEffectivePwaBranding(input: PwaBrandingInput): EffectivePwaBranding {
  const appName = input.customBrandingEnabled && input.settings?.app_name?.trim() ? input.settings.app_name.trim() : input.workspaceName?.trim() || PRODUCT_CONFIG.name
  const iconUrl = input.customBrandingEnabled && input.settings?.icon_url?.trim() ? input.settings.icon_url.trim() : PWA_FALLBACK_ICON
  return { workspaceId: input.workspaceId, appName, shortName: shortAppName(appName), iconUrl, themeColor: input.customBrandingEnabled && input.settings?.theme_color || PWA_DEFAULT_THEME_COLOR, backgroundColor: input.customBrandingEnabled && input.settings?.background_color || PWA_DEFAULT_BACKGROUND_COLOR, customBrandingEnabled: Boolean(input.customBrandingEnabled), customIconUrl: input.settings?.icon_url || null, iconVersion: input.settings?.icon_url ? null : null }
}
export const getEffectivePwaBranding = cache(async function getEffectivePwaBranding(workspaceId: string): Promise<EffectivePwaBranding> {
  const service = createServiceRoleClient() as any
  const [{ data: workspace }, { data: settings }] = await Promise.all([service.from("workspaces").select("id, name").eq("id", workspaceId).maybeSingle(), service.from("workspace_pwa_settings").select("app_name, icon_url, theme_color, background_color").eq("workspace_id", workspaceId).maybeSingle()])
  return buildEffectivePwaBranding({ workspaceId, workspaceName: workspace?.name, settings, customBrandingEnabled: await can(workspaceId, "customPWA") })
})
export const getPublicPwaBranding = cache(async function getPublicPwaBranding(workspaceId: string): Promise<EffectivePwaBranding | null> {
  const service = createServiceRoleClient() as any
  const [{ data: workspace }, { data: settings }] = await Promise.all([service.from("workspaces").select("id, name").eq("id", workspaceId).maybeSingle(), service.from("workspace_pwa_settings").select("app_name, icon_url, theme_color, background_color").eq("workspace_id", workspaceId).maybeSingle()])
  return workspace ? buildEffectivePwaBranding({ workspaceId, workspaceName: workspace.name, settings, customBrandingEnabled: await can(workspaceId, "customPWA") }) : null
})
export function getGenericPwaBranding(): EffectivePwaBranding { return buildEffectivePwaBranding({ workspaceId: null }) }
export function storagePathFromPublicUrl(value: string | null | undefined) {
  if (!value) return null
  if (value.startsWith("/api/core-data/icon?")) {
    return new URL(value, "http://localhost").searchParams.get("path")
  }
  const marker = "/storage/v1/object/public/workspace-assets/"
  const index = value.indexOf(marker)
  if (index < 0) return null
  try { return decodeURIComponent(value.slice(index + marker.length)) } catch { return null }
}
