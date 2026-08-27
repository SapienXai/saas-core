import "server-only"

import { getConfiguredRootDomain } from "@/lib/domains/hostname"
import { getActiveCustomDomainForRestaurant } from "@/lib/domains/public-resolver"
import { getWorkspaceEntitlements } from "@/lib/entitlements"
import { createServiceRoleClient } from "@/lib/supabase"

export type PublicRestaurantUrlInput = {
  id?: string | null
  slug: string
  workspaceId?: string | null
}

function configuredSiteOrigin() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (configured) {
    try {
      const url = new URL(configured)
      return url.origin
    } catch {
      // Fall through to the safe local default.
    }
  }
  return "http://localhost:3000"
}

export function getHostedRestaurantUrl(slug: string) {
  const siteOrigin = configuredSiteOrigin()
  const isLocal = siteOrigin.includes("localhost") || siteOrigin.includes("127.0.0.1")
  if (process.env.NODE_ENV !== "production" || isLocal) {
    return `${siteOrigin}/r/${encodeURIComponent(slug)}`
  }
  return `https://${slug}.${getConfiguredRootDomain()}`
}

export function getHostedBrandUrl(slug: string) {
  const siteOrigin = configuredSiteOrigin()
  const isLocal = siteOrigin.includes("localhost") || siteOrigin.includes("127.0.0.1")
  if (process.env.NODE_ENV !== "production" || isLocal) {
    return `${siteOrigin}/brand/${encodeURIComponent(slug)}`
  }
  return `${siteOrigin}/brand/${encodeURIComponent(slug)}`
}

export function getCustomRestaurantUrl(hostname: string) {
  return `https://${hostname}`
}

/**
 * Return the preferred public URL without asking Vercel. A verified active
 * custom domain is preferred only while the current entitlement permits it;
 * the hosted slug URL remains the durable fallback.
 */
export async function getRestaurantPublicUrl(restaurant: PublicRestaurantUrlInput) {
  const hostedUrl = getHostedRestaurantUrl(restaurant.slug)
  let restaurantId = restaurant.id || null
  let workspaceId = restaurant.workspaceId || null
  if (!restaurantId) {
    const { data } = await createServiceRoleClient()
      .from("restaurants")
      .select("id, workspace_id")
      .eq("slug", restaurant.slug)
      .maybeSingle()
    restaurantId = data?.id || null
    workspaceId = data?.workspace_id || null
  }
  if (!restaurantId) return hostedUrl

  const domain = await getActiveCustomDomainForRestaurant(restaurantId)
  if (!domain || domain.status !== "active" || !domain.provider_verified || !domain.dns_configured) {
    return hostedUrl
  }

  let entitled = false
  try {
    if (workspaceId) {
      const entitlements = await getWorkspaceEntitlements(workspaceId)
      entitled = entitlements.features.customDomain
    }
  } catch (error) {
    console.error("Could not resolve public URL entitlement", error)
  }

  return entitled ? getCustomRestaurantUrl(domain.hostname) : hostedUrl
}
