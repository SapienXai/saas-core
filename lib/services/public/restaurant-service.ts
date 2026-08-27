import { createServiceRoleClient } from "@/lib/supabase"
import { defaultMedia } from "@/lib/fallback-data"
import { toPublicRestaurantProfile, type PublicRestaurantProfile } from "@/lib/restaurant-profile"
import { getRestaurantReservationQuotaState, getWorkspaceEntitlements, getWorkspaceRestaurantPlanState, isRestaurantWithinWorkspacePlanLimit } from "@/lib/entitlements"
import { getPublicRestaurantClaimState } from "@/lib/claimable-restaurants"
import { GENERIC_RESTAURANT_MEDIA_FALLBACK, getSafeRestaurantAssetUrl } from "@/lib/legacy-assets"

export const PUBLIC_RESTAURANT_FIELDS = "id, slug, name, logo_url, primary_image_url, description, cuisine, hours, atmosphere, phone, whatsapp, menu_url, location_url, events_url, social_links, profile_visibility, location, address_line1, address_line2, address_locality, address_region, address_postal_code, address_country, latitude, longitude, official_website_url, timezone, language, status, platform_status, workspace_id, reservation_enabled, required_guest_fields, optional_guest_fields, allowed_days_of_week, opening_time, closing_time, time_slot_duration, advance_booking_days, min_advance_hours, max_party_size, min_party_size, reservation_start_date, reservation_blocked_intervals, reservation_notices, blocked_dates, special_hours, meal_only_reservations, created_at, updated_at"
export const PUBLIC_PROFILE_FIELDS = "id, slug, name, logo_url, primary_image_url, description, cuisine, hours, atmosphere, phone, whatsapp, menu_url, location_url, events_url, social_links, profile_visibility, location, address_line1, address_line2, address_locality, address_region, address_postal_code, address_country, latitude, longitude, official_website_url, timezone, language, status, platform_status, reservation_enabled, reservation_start_date, updated_at"
export const PUBLIC_PROFILE_FIELDS_WITH_WORKSPACE = `${PUBLIC_PROFILE_FIELDS}, workspace_id`

async function hasActiveWorkspace(supabase: any, workspaceId: string | null | undefined) {
  if (!workspaceId) return true
  const { data: workspace, error } = await supabase.from("workspaces").select("platform_status").eq("id", workspaceId).maybeSingle()
  return !error && (!workspace || workspace.platform_status === "active")
}

export async function fetchRestaurantByName(name: string) {
  try {
    const supabase = createServiceRoleClient() as any
    const { data, error } = await supabase
      .from("restaurants")
      .select(PUBLIC_RESTAURANT_FIELDS)
      .ilike("name", name)
      .eq("status", "published")
      .eq("platform_status", "active")
      .limit(1)
      .maybeSingle()

    if (error) {
      console.warn("fetchRestaurantByName query error:", error.message)
      return null
    }

    if (!(await hasActiveWorkspace(supabase, data?.workspace_id))) return null
    if (data?.workspace_id && !(await isRestaurantWithinWorkspacePlanLimit(data.workspace_id, data.id))) return null
    if (data?.workspace_id) {
      const quota = await getRestaurantReservationQuotaState(data.id)
      if (quota && !quota.available) return { ...data, reservation_enabled: false }
    }

    return data
  } catch (err) {
    console.warn("fetchRestaurantByName failed:", String(err))
    return null
  }
}

export async function fetchRestaurantBySlug(slug: string) {
  try {
    const supabase = createServiceRoleClient() as any
    const { data, error } = await supabase
      .from("restaurants")
      .select(PUBLIC_RESTAURANT_FIELDS)
      .eq("slug", slug)
      .eq("status", "published")
      .eq("platform_status", "active")
      .limit(1)
      .maybeSingle()

    if (error) {
      console.warn("fetchRestaurantBySlug query error:", error.message)
      return null
    }

    if (!(await hasActiveWorkspace(supabase, data?.workspace_id))) return null
    if (data?.workspace_id && !(await isRestaurantWithinWorkspacePlanLimit(data.workspace_id, data.id))) return null
    if (data?.workspace_id) {
      const quota = await getRestaurantReservationQuotaState(data.id)
      if (quota && !quota.available) return { ...data, reservation_enabled: false }
    }

    return data
  } catch (err) {
    console.warn("fetchRestaurantBySlug failed:", String(err))
    return null
  }
}

export async function fetchPublicRestaurantProfileBySlug(slug: string): Promise<PublicRestaurantProfile | null> {
  const supabase = createServiceRoleClient() as any
  const { data: restaurant, error } = await supabase
    .from("restaurants")
    .select(PUBLIC_PROFILE_FIELDS_WITH_WORKSPACE)
    .eq("slug", slug)
    .eq("status", "published")
    .eq("platform_status", "active")
    .limit(1)
    .maybeSingle()
  if (error) {
    console.warn("fetchPublicRestaurantProfileBySlug query error:", error.message)
    return null
  }
  if (!restaurant) return null
  if (!(await hasActiveWorkspace(supabase, restaurant.workspace_id))) return null
  if (restaurant.workspace_id && !(await isRestaurantWithinWorkspacePlanLimit(restaurant.workspace_id, restaurant.id))) return null
  let showReserveviaBranding = true
  if (restaurant.workspace_id) {
    try {
      const entitlements = await getWorkspaceEntitlements(restaurant.workspace_id)
      showReserveviaBranding = !entitlements.features.removeReserveviaBranding
    } catch (error) {
      console.error("Could not resolve public restaurant branding entitlement:", error)
    }
  }
  const claimState = await getPublicRestaurantClaimState(restaurant.id)
  return toPublicRestaurantProfile(restaurant, { showReserveviaBranding, restaurantId: restaurant.id, isClaimable: claimState.isClaimable })
}

export type PublicRestaurantSitemapEntry = {
  id: string
  slug: string
  updatedAt: string | null
}

export async function fetchPublicRestaurantSitemapEntries(): Promise<PublicRestaurantSitemapEntry[]> {
  try {
    const supabase = createServiceRoleClient() as any
    const { data, error } = await supabase
      .from("restaurants")
      .select("id, slug, workspace_id, updated_at")
      .eq("status", "published")
      .eq("platform_status", "active")
      .order("updated_at", { ascending: false })
      .order("slug", { ascending: true })

    if (error) {
      console.error("fetchPublicRestaurantSitemapEntries query error:", error.message)
      return []
    }

    const rows = data || []
    const workspaceIds = Array.from(new Set(rows.map((restaurant: { workspace_id?: string | null }) => restaurant.workspace_id).filter(Boolean))) as string[]
    const activeWorkspaceIds = new Set<string>()

    if (workspaceIds.length > 0) {
      const { data: workspaces, error: workspaceError } = await supabase
        .from("workspaces")
        .select("id")
        .in("id", workspaceIds)
        .eq("platform_status", "active")

      if (workspaceError) {
        console.error("fetchPublicRestaurantSitemapEntries workspace query error:", workspaceError.message)
        return []
      }
      for (const workspace of workspaces || []) activeWorkspaceIds.add(workspace.id)
    }

    const planStates = new Map<string, Awaited<ReturnType<typeof getWorkspaceRestaurantPlanState>>>()
    await Promise.all(workspaceIds.map(async (workspaceId) => {
      if (!activeWorkspaceIds.has(workspaceId)) return
      try {
        planStates.set(workspaceId, await getWorkspaceRestaurantPlanState(workspaceId))
      } catch (planError) {
        console.error("fetchPublicRestaurantSitemapEntries plan query error:", planError)
      }
    }))

    return rows
      .filter((restaurant: { id: string; workspace_id?: string | null }) => {
        if (!restaurant.workspace_id) return true
        return activeWorkspaceIds.has(restaurant.workspace_id)
          && planStates.get(restaurant.workspace_id)?.liveRestaurantIds.includes(restaurant.id) === true
      })
      .map((restaurant: { id: string; slug: string; updated_at?: string | null }) => ({
        id: restaurant.id,
        slug: restaurant.slug,
        updatedAt: restaurant.updated_at ?? null,
      }))
  } catch (error) {
    console.error("fetchPublicRestaurantSitemapEntries failed:", error)
    return []
  }
}

export async function isRestaurantPlatformActive(restaurantId: string) {
  const supabase = createServiceRoleClient() as any
  const { data: restaurant, error } = await supabase
    .from("restaurants")
    .select("id, workspace_id, platform_status")
    .eq("id", restaurantId)
    .maybeSingle()
  if (error || !restaurant || restaurant.platform_status !== "active") return false
  if (!restaurant.workspace_id) return true
  if (!(await hasActiveWorkspace(supabase, restaurant.workspace_id))) return false
  return isRestaurantWithinWorkspacePlanLimit(restaurant.workspace_id, restaurant.id)
}

export async function fetchActiveReservationAreas(restaurantId: string) {
  try {
    const supabase = createServiceRoleClient()
    const { data, error } = await supabase
      .from("reservation_areas")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .order("display_order", { ascending: true })

    if (error) {
      console.warn("fetchActiveReservationAreas error:", error.message)
      return []
    }

    return data || []
  } catch (err) {
    console.warn("fetchActiveReservationAreas failed:", String(err))
    return []
  }
}

export async function fetchRestaurantMedia(restaurantId: string) {
  try {
    const supabase = createServiceRoleClient()
    const { data, error } = await supabase
      .from("restaurant_media")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("media_order")

    if (error) {
      console.error("Error fetching restaurant media:", error)
      return defaultMedia
    }

    const safeMedia = (data || []).map((media) => ({
      ...media,
      media_url: getSafeRestaurantAssetUrl(media.media_url, GENERIC_RESTAURANT_MEDIA_FALLBACK) || GENERIC_RESTAURANT_MEDIA_FALLBACK,
    }))
    return safeMedia.length ? safeMedia : defaultMedia
  } catch (err) {
    const msg = String((err as { message?: unknown })?.message || err || "")
    if (msg.includes("Unexpected token") || msg.toLowerCase().includes("invalid")) {
      console.warn("Using fallback media due to Supabase misconfiguration.")
      return defaultMedia
    }
    console.error("Error in fetchRestaurantMedia:", msg)
    return defaultMedia
  }
}
