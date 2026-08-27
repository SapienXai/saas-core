import "server-only"

import { headers } from "next/headers"
import { classifyHostname, getCustomerHostnameParts, type HostnameClassification, type HostnameKind } from "@/lib/domains/hostname"
import { fetchPublicRestaurantProfileBySlug } from "@/lib/services/public/restaurant-service"
import { fetchPublicBrandByWorkspaceId, toPublicBrandView, type PublicBrand } from "@/lib/services/public/brand-service"
import { getWorkspaceEntitlements } from "@/lib/entitlements"
import { createServiceRoleClient } from "@/lib/supabase"
import type { PublicRestaurantProfile } from "@/lib/restaurant-profile"

export type PublicRestaurantRequestState = "resolved" | "suspended" | "unavailable"

export type PublicRestaurantRequest = {
  classification: HostnameClassification
  hostname: string | null
  kind: HostnameKind
  state: PublicRestaurantRequestState
  restaurant: PublicRestaurantProfile | null
  restaurantSlug: string | null
  restaurantId: string | null
  workspaceId: string | null
  brand: PublicBrand | null
}

function emptyResult(classification: HostnameClassification, state: PublicRestaurantRequestState = "unavailable"): PublicRestaurantRequest {
  return {
    classification,
    hostname: classification.hostname,
    kind: classification.kind,
    state,
    restaurant: null,
    restaurantSlug: null,
    restaurantId: null,
    workspaceId: null,
    brand: null,
  }
}

async function getRequestHostname() {
  const requestHeaders = await headers()
  return requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim() || requestHeaders.get("host") || ""
}

async function getPublishedRestaurantIdentity(restaurantId: string) {
  const supabase = createServiceRoleClient() as any
  const { data, error } = await supabase
    .from("restaurants")
    .select("id, slug, workspace_id, status, platform_status")
    .eq("id", restaurantId)
    .eq("status", "published")
    .eq("platform_status", "active")
    .maybeSingle()
  if (error || !data) return null
  if (data.workspace_id) {
    const { data: workspace } = await supabase.from("workspaces").select("platform_status").eq("id", data.workspace_id).maybeSingle()
    if (workspace && workspace.platform_status !== "active") return null
  }
  return data as { id: string; slug: string; workspace_id: string | null; status: string; platform_status: string }
}

async function resolveHostedRestaurant(classification: HostnameClassification) {
  if (!classification.restaurantSlug) return null
  const restaurant = await fetchPublicRestaurantProfileBySlug(classification.restaurantSlug)
  if (!restaurant) return null
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from("restaurants")
    .select("id, workspace_id")
    .eq("slug", restaurant.slug)
    .eq("status", "published")
    .maybeSingle()
  return {
    restaurant,
    restaurantId: data?.id || null,
    workspaceId: data?.workspace_id || null,
  }
}

async function resolveCustomRestaurant(classification: HostnameClassification) {
  if (!classification.hostname) return null
  const hostnameParts = getCustomerHostnameParts(classification.hostname)
  if (!hostnameParts || hostnameParts.isApex) return null
  const supabase = createServiceRoleClient()
  let { data: domain, error } = await supabase
    .from("restaurant_domains")
    .select("id, hostname, restaurant_id, public_surface, status, provider_verified, dns_configured")
    .eq("hostname", classification.hostname)
    .in("status", ["active", "suspended"])
    .maybeSingle()

  if (error?.code === "42703") {
    const legacy = await supabase
      .from("restaurant_domains")
      .select("id, hostname, restaurant_id, status, provider_verified, dns_configured")
      .eq("hostname", classification.hostname)
      .in("status", ["active", "suspended"])
      .maybeSingle()
    domain = legacy.data ? { ...legacy.data, public_surface: "restaurant" } : null
    error = legacy.error
  }
  if (error || !domain) return null
  const identity = await getPublishedRestaurantIdentity(domain.restaurant_id)
  if (!identity || !identity.workspace_id) return null

  if (domain.public_surface === "brand") {
    const brand = await fetchPublicBrandByWorkspaceId(identity.workspace_id)
    let entitled = false
    try {
      const entitlements = await getWorkspaceEntitlements(identity.workspace_id)
      entitled = entitlements.features.multiRestaurant
    } catch (entitlementError) {
      console.error("Could not resolve brand-domain entitlement for public request", entitlementError)
    }
    const providerReady = domain.provider_verified === true && domain.dns_configured === true
    if (!brand) return null
    return {
      restaurant: null,
      restaurantId: null,
      workspaceId: identity.workspace_id,
      brand: toPublicBrandView(brand),
      state: domain.status === "active" && providerReady && entitled ? "resolved" as const : "suspended" as const,
    }
  }

  const restaurant = await fetchPublicRestaurantProfileBySlug(identity.slug)
  if (!restaurant) return null

  let entitled = false
  try {
    const entitlements = await getWorkspaceEntitlements(identity.workspace_id)
    entitled = entitlements.features.customDomain
  } catch (entitlementError) {
    console.error("Could not resolve custom-domain entitlement for public request", entitlementError)
  }

  const providerReady = domain.provider_verified === true && domain.dns_configured === true
  if (domain.status === "active" && providerReady && entitled) {
    return { restaurant, restaurantId: identity.id, workspaceId: identity.workspace_id, brand: null, state: "resolved" as const }
  }

  // Keep the mapping and the hosted fallback available after a downgrade or
  // provider drift, but never serve the paid hostname as an active feature.
  if (domain.status === "suspended" || !entitled || !providerReady) {
    return { restaurant, restaurantId: identity.id, workspaceId: identity.workspace_id, brand: null, state: "suspended" as const }
  }

  return null
}

/**
 * Resolve the public restaurant from the request hostname. This is a server
 * boundary: hosted slugs are derived from the hostname, while customer-owned
 * domains are looked up from the verified local mapping. The Vercel API is
 * intentionally never called during public rendering.
 */
export async function resolvePublicRestaurantRequest(hostname?: string): Promise<PublicRestaurantRequest> {
  const rawHostname = hostname || await getRequestHostname()
  const classification = classifyHostname(rawHostname)

  if (classification.kind === "HOSTED_RESTAURANT") {
    const resolved = await resolveHostedRestaurant(classification)
    if (!resolved) return emptyResult(classification)
    return {
      classification,
      hostname: classification.hostname,
      kind: classification.kind,
      state: "resolved",
      restaurant: resolved.restaurant,
      restaurantSlug: resolved.restaurant.slug,
      restaurantId: resolved.restaurantId,
      workspaceId: resolved.workspaceId,
      brand: null,
    }
  }

  if (classification.kind === "CUSTOM_RESTAURANT") {
    const resolved = await resolveCustomRestaurant(classification)
    if (!resolved) return emptyResult(classification)
    return {
      classification,
      hostname: classification.hostname,
      kind: classification.kind,
      state: resolved.state,
      restaurant: resolved.restaurant,
      restaurantSlug: resolved.restaurant?.slug || null,
      restaurantId: resolved.restaurantId,
      workspaceId: resolved.workspaceId,
      brand: resolved.brand || null,
    }
  }

  return emptyResult(classification)
}

export async function resolveRestaurantForHostname(hostname?: string) {
  const result = await resolvePublicRestaurantRequest(hostname)
  if (result.kind !== "HOSTED_RESTAURANT" && result.kind !== "CUSTOM_RESTAURANT") return null
  return result
}

export async function getActiveCustomDomainForRestaurant(restaurantId: string) {
  const supabase = createServiceRoleClient()
  let { data, error } = await supabase
    .from("restaurant_domains")
    .select("id, restaurant_id, hostname, public_surface, status, provider, provider_environment, verification_state, provider_verified, dns_configured, verified_at, last_checked_at, last_error_code, last_error_message, created_at, updated_at")
    .eq("restaurant_id", restaurantId)
    .eq("public_surface", "restaurant")
    .in("status", ["active", "suspended", "pending", "verifying", "error"])
    .maybeSingle()
  if (error?.code === "42703") {
    const legacy = await supabase
      .from("restaurant_domains")
      .select("id, restaurant_id, hostname, status, provider, provider_environment, verification_state, provider_verified, dns_configured, verified_at, last_checked_at, last_error_code, last_error_message, created_at, updated_at")
      .eq("restaurant_id", restaurantId)
      .in("status", ["active", "suspended", "pending", "verifying", "error"])
      .maybeSingle()
    data = legacy.data ? { ...legacy.data, public_surface: "restaurant" } : null
    error = legacy.error
  }
  if (error) throw new Error(error.message)
  return data
}
