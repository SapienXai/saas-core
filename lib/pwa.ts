import "server-only"

import { can } from "@/lib/entitlements"
import { createServiceRoleClient } from "@/lib/supabase"
import { RESERVEVIA_PWA_ICON } from "@/lib/brand-assets"
import { getAssetVersion } from "@/lib/asset-version"
import { getSafeRestaurantAssetUrl } from "@/lib/legacy-assets"
import { cache } from "react"

export const PWA_FALLBACK_ICON = RESERVEVIA_PWA_ICON
export const PWA_DEFAULT_THEME_COLOR = "#1e40af"
export const PWA_DEFAULT_BACKGROUND_COLOR = "#ffffff"
const PWA_ICON_RENDER_VERSION = "2"

export type EffectivePwaBranding = {
  workspaceId: string | null
  restaurantId: string | null
  appName: string
  shortName: string
  iconUrl: string
  themeColor: string
  backgroundColor: string
  customBrandingEnabled: boolean
  customIconUrl: string | null
  iconVersion: string | null
}

export type RestaurantPwaBrandSource = Pick<
  { logo_url?: string | null; primary_image_url?: string | null },
  "logo_url" | "primary_image_url"
>

type PwaBrandingInput = {
  workspaceId: string
  workspaceName?: string | null
  restaurantId?: string | null
  restaurants?: Array<{
    id: string
    name: string
    logo_url?: string | null
    primary_image_url?: string | null
    updated_at?: string | null
  }>
  settings?: {
    app_name?: string | null
    icon_url?: string | null
    theme_color?: string | null
    background_color?: string | null
  } | null
  customBrandingEnabled: boolean
}

export function getRestaurantPwaIcon(restaurant: RestaurantPwaBrandSource | null | undefined) {
  return getSafeRestaurantAssetUrl(restaurant?.logo_url) || getSafeRestaurantAssetUrl(restaurant?.primary_image_url) || PWA_FALLBACK_ICON
}

export function getPwaIconAssetUrl(
  branding: Pick<EffectivePwaBranding, "workspaceId" | "restaurantId" | "iconUrl"> & { iconVersion?: string | null },
  size?: 180 | 192 | 512,
) {
  if (!branding.workspaceId || branding.iconUrl === PWA_FALLBACK_ICON) return branding.iconUrl

  const params = new URLSearchParams({ workspace: branding.workspaceId })
  if (branding.restaurantId) params.set("restaurant", branding.restaurantId)
  if (size) params.set("size", String(size))
  params.set("v", getPwaIconVersion(branding))
  params.set("render", PWA_ICON_RENDER_VERSION)
  return `/pwa/icon?${params.toString()}`
}

export function getPwaIconVersion(
  branding: Pick<EffectivePwaBranding, "iconUrl"> & { iconVersion?: string | null },
) {
  return getAssetVersion(branding.iconUrl, branding.iconVersion)
}

function shortAppName(value: string) {
  return value.length > 24 ? `${value.slice(0, 21).trimEnd()}…` : value
}

export function buildEffectivePwaBranding(input: PwaBrandingInput): EffectivePwaBranding {
  const firstRestaurant = input.restaurants?.[0] || null
  const selectedRestaurant = input.restaurantId
    ? input.restaurants?.find((restaurant) => restaurant.id === input.restaurantId) || null
    : input.restaurants?.length === 1
      ? firstRestaurant
      : null
  const defaultName = selectedRestaurant?.name || input.workspaceName || "Reservevia"
  const defaultIcon = getRestaurantPwaIcon(selectedRestaurant)
  const appName = input.customBrandingEnabled && input.settings?.app_name?.trim()
    ? input.settings.app_name.trim()
    : defaultName
  const iconUrl = input.customBrandingEnabled && input.settings?.icon_url
    ? input.settings.icon_url
    : defaultIcon
  const iconVersion = input.customBrandingEnabled && input.settings?.icon_url
    ? null
    : selectedRestaurant?.updated_at || null

  return {
    workspaceId: input.workspaceId,
    restaurantId: selectedRestaurant?.id || null,
    appName,
    shortName: shortAppName(appName),
    iconUrl,
    themeColor: input.customBrandingEnabled && input.settings?.theme_color ? input.settings.theme_color : PWA_DEFAULT_THEME_COLOR,
    backgroundColor: input.customBrandingEnabled && input.settings?.background_color ? input.settings.background_color : PWA_DEFAULT_BACKGROUND_COLOR,
    customBrandingEnabled: input.customBrandingEnabled,
    customIconUrl: input.settings?.icon_url || null,
    iconVersion,
  }
}

export const getEffectivePwaBranding = cache(async function getEffectivePwaBranding(workspaceId: string, restaurantId?: string | null): Promise<EffectivePwaBranding> {
  const supabase = createServiceRoleClient()
  const [{ data: workspace }, { data: settings }, { data: restaurants }] = await Promise.all([
    supabase.from("workspaces").select("id, name").eq("id", workspaceId).maybeSingle(),
    supabase.from("workspace_pwa_settings").select("app_name, icon_url, theme_color, background_color").eq("workspace_id", workspaceId).maybeSingle(),
    supabase.from("restaurants").select("id, name, logo_url, primary_image_url, created_at, updated_at").eq("workspace_id", workspaceId).order("created_at", { ascending: true }),
  ])

  const customBrandingEnabled = await can(workspaceId, "customPWA")
  return buildEffectivePwaBranding({
    workspaceId,
    workspaceName: workspace?.name,
    restaurantId,
    restaurants: restaurants || undefined,
    settings,
    customBrandingEnabled,
  })
})

/**
 * Resolve the public-safe branding used by a manifest request when the
 * browser does not send the management session cookie. The manifest only
 * exposes install metadata and public asset URLs; the start URL still lands
 * in the authenticated management application.
 */
export const getPublicPwaBranding = cache(async function getPublicPwaBranding(workspaceId: string, restaurantId?: string | null): Promise<EffectivePwaBranding | null> {
  const supabase = createServiceRoleClient()
  const [{ data: workspace }, { data: settings }, { data: restaurants }] = await Promise.all([
    supabase.from("workspaces").select("id, name").eq("id", workspaceId).maybeSingle(),
    supabase.from("workspace_pwa_settings").select("app_name, icon_url, theme_color, background_color").eq("workspace_id", workspaceId).maybeSingle(),
    supabase.from("restaurants").select("id, name, logo_url, primary_image_url, created_at, updated_at").eq("workspace_id", workspaceId).order("created_at", { ascending: true }),
  ])

  if (!workspace) return null

  return buildEffectivePwaBranding({
    workspaceId,
    workspaceName: workspace.name,
    restaurantId,
    restaurants: restaurants || undefined,
    settings,
    customBrandingEnabled: await can(workspaceId, "customPWA"),
  })
})

export function getGenericPwaBranding(): EffectivePwaBranding {
  return {
    workspaceId: null,
    restaurantId: null,
    appName: "Reservevia",
    shortName: "Reservevia",
    iconUrl: PWA_FALLBACK_ICON,
    themeColor: PWA_DEFAULT_THEME_COLOR,
    backgroundColor: PWA_DEFAULT_BACKGROUND_COLOR,
    customBrandingEnabled: false,
    customIconUrl: null,
    iconVersion: null,
  }
}

export function storagePathFromPublicUrl(value: string | null | undefined) {
  const marker = "/storage/v1/object/public/restaurant-assets/"
  if (!value) return null
  const index = value.indexOf(marker)
  return index >= 0 ? decodeURIComponent(value.slice(index + marker.length)) : null
}
