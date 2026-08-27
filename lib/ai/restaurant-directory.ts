import "server-only"

import { getHostedRestaurantUrl } from "@/lib/domains/public-url"
import { getWorkspaceRestaurantPlanState, isRestaurantWithinWorkspacePlanLimit } from "@/lib/entitlements"
import { getRestaurantAiReadiness, type AiReadinessRestaurant } from "@/lib/ai/readiness"
import { createServiceRoleClient } from "@/lib/supabase"
import { fetchPublicRestaurantDirectory } from "@/lib/services/manage/restaurant-service"
import { toPublicRestaurantProfile, type PublicRestaurantProfile } from "@/lib/restaurant-profile"

export const AI_RESTAURANT_FIELDS = "id, slug, name, logo_url, primary_image_url, description, cuisine, hours, atmosphere, phone, whatsapp, menu_url, location_url, events_url, social_links, profile_visibility, location, address_line1, address_line2, address_locality, address_region, address_postal_code, address_country, latitude, longitude, official_website_url, timezone, language, status, platform_status, workspace_id, reservation_enabled, required_guest_fields, optional_guest_fields, allowed_days_of_week, opening_time, closing_time, time_slot_duration, advance_booking_days, min_advance_hours, max_party_size, min_party_size, reservation_start_date, reservation_blocked_intervals, reservation_notices, blocked_dates, special_hours, meal_only_reservations, updated_at"

type RestaurantRow = AiReadinessRestaurant & {
  workspace_id?: string | null
  logo_url?: string | null
  primary_image_url?: string | null
  description?: string | null
  cuisine?: string | null
  hours?: string | null
  atmosphere?: string | null
  whatsapp?: string | null
  menu_url?: string | null
  location_url?: string | null
  events_url?: string | null
  social_links?: unknown
  profile_visibility?: unknown
  language?: string | null
  reservation_start_date?: string | null
  updated_at?: string | null
}

export type PublicRestaurantDto = {
  restaurant_id: string
  name: string
  slug: string
  address: {
    line1: string | null
    line2: string | null
    locality: string | null
    region: string | null
    postal_code: string | null
    country: string | null
    formatted: string | null
  }
  location: { latitude: number | null; longitude: number | null }
  phone_number: string | null
  website_url: string | null
  booking_url: string
  platform_url: string
  timezone: string
  reservation_capability: boolean
  required_guest_fields: string[]
  optional_guest_fields: string[]
  updated_at: string | null
}

function formatAddress(row: RestaurantRow) {
  const formatted = [row.address_line1, row.address_line2, row.address_locality, row.address_region, row.address_postal_code, row.address_country]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(", ") || row.location || null
  return {
    line1: row.address_line1 || null,
    line2: row.address_line2 || null,
    locality: row.address_locality || null,
    region: row.address_region || null,
    postal_code: row.address_postal_code || null,
    country: row.address_country || null,
    formatted,
  }
}

function normalizePhone(value: string | null | undefined) {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const normalized = trimmed.replace(/[^\d+]/g, "")
  return normalized || null
}

export function toPublicRestaurantDto(row: RestaurantRow, options: { canonicalUrl?: string } = {}): PublicRestaurantDto {
  const platformUrl = options.canonicalUrl || getHostedRestaurantUrl(row.slug || row.id)
  return {
    restaurant_id: row.id,
    name: row.name || "",
    slug: row.slug || "",
    address: formatAddress(row),
    location: { latitude: row.latitude ?? null, longitude: row.longitude ?? null },
    phone_number: normalizePhone(row.phone),
    website_url: row.official_website_url || null,
    booking_url: `${platformUrl.replace(/\/$/, "")}/reserve?restaurantSlug=${encodeURIComponent(row.slug || "")}`,
    platform_url: platformUrl,
    timezone: row.timezone || "UTC",
    reservation_capability: row.reservation_enabled === true,
    required_guest_fields: Array.isArray((row as any).required_guest_fields) ? (row as any).required_guest_fields : ["name", "phone"],
    optional_guest_fields: Array.isArray((row as any).optional_guest_fields) ? (row as any).optional_guest_fields : ["email", "notes"],
    updated_at: row.updated_at || null,
  }
}

async function hasPublicAccess(supabase: any, row: RestaurantRow) {
  if (row.status !== "published" || row.platform_status !== "active") return false
  if (row.workspace_id) {
    const workspace = await supabase.from("workspaces").select("platform_status").eq("id", row.workspace_id).maybeSingle()
    if (workspace.error || workspace.data?.platform_status !== "active") return false
    if (!(await isRestaurantWithinWorkspacePlanLimit(row.workspace_id, row.id))) return false
  }
  return true
}

export async function getPublicRestaurantById(id: string) {
  const supabase = createServiceRoleClient() as any
  const result = await supabase.from("restaurants").select(AI_RESTAURANT_FIELDS).eq("id", id).maybeSingle()
  if (result.error || !result.data || !(await hasPublicAccess(supabase, result.data))) return null
  return result.data as RestaurantRow
}

export async function getPublicRestaurantProfileById(id: string): Promise<PublicRestaurantProfile | null> {
  const row = await getPublicRestaurantById(id)
  if (!row) return null
  return toPublicRestaurantProfile(row as any, { restaurantId: row.id })
}

export async function searchPublicRestaurants(input: {
  query?: string
  locality?: string
  country?: string
  latitude?: number
  longitude?: number
  radius?: number
  pageSize?: number
  pageToken?: string
}) {
  const page = await fetchPublicRestaurantDirectory({
    q: input.query,
    location: input.locality,
    cuisine: undefined,
    atmosphere: undefined,
    page: 1,
    pageSize: Math.min(input.pageSize || 20, 50),
  })
  const filtered = input.country
    ? page.restaurants.filter((restaurant) => restaurant.address.country?.toLowerCase() === input.country?.toLowerCase())
    : page.restaurants
  const withDistance = filtered.map((restaurant) => ({ restaurant, distance: distanceKm(input.latitude, input.longitude, restaurant.latitude, restaurant.longitude) }))
    .filter(({ distance }) => input.radius === undefined || distance === null || distance <= input.radius)
    .sort((left, right) => (left.distance ?? Number.POSITIVE_INFINITY) - (right.distance ?? Number.POSITIVE_INFINITY))
  return withDistance.map(({ restaurant }) => toPublicRestaurantDto({
    ...restaurant,
    id: restaurant.restaurantId || "",
    slug: restaurant.slug,
    name: restaurant.name,
    address_line1: restaurant.address.line1,
    address_line2: restaurant.address.line2,
    address_locality: restaurant.address.locality,
    address_region: restaurant.address.region,
    address_postal_code: restaurant.address.postalCode,
    address_country: restaurant.address.country,
    latitude: restaurant.latitude,
    longitude: restaurant.longitude,
    location: restaurant.location,
    official_website_url: restaurant.officialWebsiteUrl,
    phone: restaurant.phone,
    timezone: restaurant.timezone,
    reservation_enabled: restaurant.reservationEnabled,
    updated_at: restaurant.updatedAt,
  } as RestaurantRow))
}

export async function getFeedEligibleRestaurants() {
  const supabase = createServiceRoleClient() as any
  const result = await supabase
    .from("restaurants")
    .select(AI_RESTAURANT_FIELDS)
    .eq("status", "published")
    .eq("platform_status", "active")
    .eq("reservation_enabled", true)
    .order("id", { ascending: true })
    .limit(10000)
  if (result.error) throw new Error(result.error.message)

  const rows = result.data as RestaurantRow[] || []
  const workspaceIds = Array.from(new Set(rows.map((row) => row.workspace_id).filter(Boolean))) as string[]
  const activeWorkspaceIds = new Set<string>()
  if (workspaceIds.length > 0) {
    const workspaces = await supabase.from("workspaces").select("id").in("id", workspaceIds).eq("platform_status", "active")
    if (workspaces.error) throw new Error(workspaces.error.message)
    for (const workspace of workspaces.data || []) activeWorkspaceIds.add(workspace.id)
  }
  const planStates = new Map<string, Awaited<ReturnType<typeof getWorkspaceRestaurantPlanState>>>()
  await Promise.all(workspaceIds.map(async (workspaceId) => {
    if (!activeWorkspaceIds.has(workspaceId)) return
    planStates.set(workspaceId, await getWorkspaceRestaurantPlanState(workspaceId))
  }))

  return rows.filter((row) => {
    if (row.workspace_id && (!activeWorkspaceIds.has(row.workspace_id) || !planStates.get(row.workspace_id)?.liveRestaurantIds.includes(row.id))) return false
    return getRestaurantAiReadiness(row).eligible
  })
}

function distanceKm(aLat: number | undefined, aLng: number | undefined, bLat: number | null, bLng: number | null) {
  if (aLat === undefined || aLng === undefined || bLat === null || bLng === null) return null
  const radians = (value: number) => value * Math.PI / 180
  const dLat = radians(bLat - aLat)
  const dLng = radians(bLng - aLng)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(aLat)) * Math.cos(radians(bLat)) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
