import "server-only"

import { getWorkspaceEntitlements, getWorkspaceRestaurantPlanState } from "@/lib/entitlements"
import { getPublicMapCoordinates, type PublicMapCoordinates } from "@/lib/public-map"
import { toPublicRestaurantProfile, type PublicRestaurantProfile } from "@/lib/restaurant-profile"
import { PUBLIC_PROFILE_FIELDS_WITH_WORKSPACE } from "@/lib/services/public/restaurant-service"
import { createServiceRoleClient } from "@/lib/supabase"

type WorkspaceRow = {
  id: string
  name: string
  slug: string
  status: string
  platform_status: string
}

export type PublicBrandBookingRule = {
  openingTime: string
  closingTime: string
  timeSlotDuration: number
  advanceBookingDays: number
  minAdvanceHours: number
  minPartySize: number
  maxPartySize: number
  allowedDaysOfWeek: number[]
  blockedDates: string[]
  reservationStartDate: string | null
  reservationEnabled: boolean
}

export type PublicBrandLocation = Omit<PublicRestaurantProfile, "restaurantId"> & {
  bookingRules: PublicBrandBookingRule[]
}

export type PublicBrand = {
  workspaceId: string
  slug: string
  name: string
  description: string
  logoUrl: string | null
  locations: PublicBrandLocation[]
}

export type InternalPublicBrandLocation = PublicBrandLocation & {
  restaurantId: string
}

export type InternalPublicBrand = Omit<PublicBrand, "locations"> & {
  locations: InternalPublicBrandLocation[]
}

const PUBLIC_BRAND_PROFILE_FIELDS_WITH_WORKSPACE = `${PUBLIC_PROFILE_FIELDS_WITH_WORKSPACE}, opening_time, closing_time, time_slot_duration, advance_booking_days, min_advance_hours, max_party_size, min_party_size, allowed_days_of_week, blocked_dates`

const DEFAULT_BOOKING_RULE_VALUES = {
  openingTime: "17:00",
  closingTime: "20:45",
  timeSlotDuration: 15,
  advanceBookingDays: 15,
  minAdvanceHours: 0,
  minPartySize: 1,
  maxPartySize: 8,
  allowedDaysOfWeek: [1, 2, 3, 4, 5, 6, 7],
  blockedDates: [],
} as const

function toPublicBrandBookingRule(restaurant: any, area?: any): PublicBrandBookingRule {
  return {
    openingTime: area?.opening_time ?? restaurant.opening_time ?? DEFAULT_BOOKING_RULE_VALUES.openingTime,
    closingTime: area?.closing_time ?? restaurant.closing_time ?? DEFAULT_BOOKING_RULE_VALUES.closingTime,
    timeSlotDuration: area?.time_slot_duration ?? restaurant.time_slot_duration ?? DEFAULT_BOOKING_RULE_VALUES.timeSlotDuration,
    advanceBookingDays: area?.advance_booking_days ?? restaurant.advance_booking_days ?? DEFAULT_BOOKING_RULE_VALUES.advanceBookingDays,
    minAdvanceHours: area?.min_advance_hours ?? restaurant.min_advance_hours ?? DEFAULT_BOOKING_RULE_VALUES.minAdvanceHours,
    minPartySize: area?.min_party_size ?? restaurant.min_party_size ?? DEFAULT_BOOKING_RULE_VALUES.minPartySize,
    maxPartySize: area?.max_party_size ?? restaurant.max_party_size ?? DEFAULT_BOOKING_RULE_VALUES.maxPartySize,
    allowedDaysOfWeek: area?.allowed_days_of_week ?? restaurant.allowed_days_of_week ?? [...DEFAULT_BOOKING_RULE_VALUES.allowedDaysOfWeek],
    blockedDates: area?.blocked_dates ?? restaurant.blocked_dates ?? [...DEFAULT_BOOKING_RULE_VALUES.blockedDates],
    reservationStartDate: restaurant.reservation_start_date ?? null,
    reservationEnabled: restaurant.reservation_enabled === true,
  }
}

function toPublicBrandBookingRules(restaurant: any, areas: any[]): PublicBrandBookingRule[] {
  return areas.length > 0
    ? areas.map((area) => toPublicBrandBookingRule(restaurant, area))
    : [toPublicBrandBookingRule(restaurant)]
}

function normalizeBrandDescription(count: number) {
  return `${count} ${count === 1 ? "location" : "locations"} · one booking link`
}

function isGoogleMapsShortLink(value: string | null) {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === "https:" && (url.hostname === "maps.app.goo.gl" || url.hostname === "goo.gl")
  } catch {
    return false
  }
}

function getGooglePlaceGeocodeQuery(value: string, locationName: string) {
  try {
    const url = new URL(value)
    const placePath = url.pathname.match(/\/maps\/place\/([^/]+)/i)?.[1]
    if (!placePath) return null

    const placeLabel = decodeURIComponent(placePath.replaceAll("+", " "))
    const city = placeLabel.split("/").at(-1)?.trim()
    return [locationName.trim(), city].filter(Boolean).join(", ") || placeLabel
  } catch {
    return null
  }
}

async function resolveGooglePlaceCoordinates(location: PublicRestaurantProfile, resolvedUrl: string, signal: AbortSignal): Promise<PublicMapCoordinates | null> {
  const query = getGooglePlaceGeocodeQuery(resolvedUrl, location.name)
  if (!query) return null

  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`, {
      signal,
      next: { revalidate: 86400 },
      headers: { "User-Agent": "ReserveVia public map resolver" },
    })
    if (!response.ok) return null
    const results = await response.json() as Array<{ lat?: string; lon?: string }>
    const latitude = Number(results[0]?.lat)
    const longitude = Number(results[0]?.lon)
    return Number.isFinite(latitude) && Number.isFinite(longitude)
      ? { latitude, longitude }
      : null
  } catch {
    return null
  }
}

async function resolveMapShortLink(location: PublicRestaurantProfile): Promise<PublicMapCoordinates | null> {
  const existingCoordinates = getPublicMapCoordinates(location)
  if (existingCoordinates || !isGoogleMapsShortLink(location.locationUrl)) return existingCoordinates

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    // Only Google Maps short links are followed. This keeps arbitrary public
    // location URLs from becoming an open server-side fetch target.
    const response = await fetch(location.locationUrl as string, {
      redirect: "follow",
      signal: controller.signal,
      next: { revalidate: 3600 },
      headers: { "User-Agent": "ReserveVia public map resolver" },
    })
    const resolvedUrlCoordinates = getPublicMapCoordinates({ ...location, locationUrl: response.url })
    if (resolvedUrlCoordinates) return resolvedUrlCoordinates
    return resolveGooglePlaceCoordinates(location, response.url, controller.signal)
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * A workspace is the existing Reservevia tenant boundary for a brand/group.
 * This read deliberately projects only published locations that are inside
 * the workspace's current restaurant entitlement window.
 */
export async function fetchPublicBrandBySlug(slug: string): Promise<InternalPublicBrand | null> {
  const normalizedSlug = slug.trim().toLowerCase()
  if (!normalizedSlug) return null

  const supabase = createServiceRoleClient() as any
  const workspaceResult = await supabase
    .from("workspaces")
    .select("id, name, slug, status, platform_status")
    .eq("slug", normalizedSlug)
    .eq("status", "active")
    .eq("platform_status", "active")
    .maybeSingle()

  if (workspaceResult.error || !workspaceResult.data) return null
  const workspace = workspaceResult.data as WorkspaceRow

  let planState: Awaited<ReturnType<typeof getWorkspaceRestaurantPlanState>>
  try {
    // Resolving the plan here keeps brand visibility consistent with the
    // existing single-restaurant public service and avoids plan-name checks.
    const [, resolvedPlanState] = await Promise.all([
      getWorkspaceEntitlements(workspace.id),
      getWorkspaceRestaurantPlanState(workspace.id),
    ])
    planState = resolvedPlanState
  } catch (error) {
    console.error("Could not resolve public brand entitlement:", error)
    return null
  }

  const locationsResult = await supabase
    .from("restaurants")
    .select(PUBLIC_BRAND_PROFILE_FIELDS_WITH_WORKSPACE)
    .eq("workspace_id", workspace.id)
    .eq("status", "published")
    .eq("platform_status", "active")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })

  if (locationsResult.error) {
    console.error("Could not load public brand locations:", locationsResult.error.message)
    return null
  }

  const restaurantRows = (locationsResult.data || []) as any[]
  const restaurantIds = restaurantRows.map((row) => row.id).filter(Boolean)
  const areasByRestaurant = new Map<string, any[]>()
  if (restaurantIds.length > 0) {
    const areasResult = await supabase
      .from("reservation_areas")
      .select("restaurant_id, opening_time, closing_time, time_slot_duration, advance_booking_days, min_advance_hours, max_party_size, min_party_size, allowed_days_of_week, blocked_dates")
      .in("restaurant_id", restaurantIds)
      .eq("is_active", true)
      .order("display_order", { ascending: true })
      .order("id", { ascending: true })

    if (areasResult.error) {
      console.warn("Could not load public brand reservation areas; using restaurant settings:", areasResult.error.message)
    } else {
      for (const area of areasResult.data || []) {
        const existing = areasByRestaurant.get(area.restaurant_id) || []
        existing.push(area)
        areasByRestaurant.set(area.restaurant_id, existing)
      }
    }
  }

  const liveIds = new Set(planState.liveRestaurantIds)
  const locations = await Promise.all(restaurantRows
    .filter((row: any) => liveIds.has(row.id))
    .map(async (row: any) => {
      const profile = toPublicRestaurantProfile(row, { restaurantId: row.id })
      const coordinates = await resolveMapShortLink(profile)
      return {
        ...profile,
        bookingRules: toPublicBrandBookingRules(row, areasByRestaurant.get(row.id) || []),
        ...(coordinates ?? {}),
        restaurantId: row.id,
      }
    })) as InternalPublicBrandLocation[]

  if (locations.length === 0) return null

  return {
    workspaceId: workspace.id,
    slug: workspace.slug,
    name: workspace.name,
    description: normalizeBrandDescription(locations.length),
    logoUrl: locations.find((location) => location.logoUrl)?.logoUrl || null,
    locations,
  }
}

export async function fetchPublicBrandByWorkspaceId(workspaceId: string) {
  const supabase = createServiceRoleClient() as any
  const result = await supabase.from("workspaces").select("slug").eq("id", workspaceId).maybeSingle()
  if (result.error || !result.data?.slug) return null
  return fetchPublicBrandBySlug(result.data.slug)
}

export function toPublicBrandView(brand: InternalPublicBrand): PublicBrand {
  return {
    workspaceId: brand.workspaceId,
    slug: brand.slug,
    name: brand.name,
    description: brand.description,
    logoUrl: brand.logoUrl,
    locations: brand.locations.map((location) => {
      const publicLocation = { ...location }
      delete (publicLocation as { restaurantId?: string }).restaurantId
      return publicLocation
    }),
  }
}

export function normalizeAvailabilityDate(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value
}

export function normalizeAvailabilityTime(value: string | null | undefined) {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return null
  const [hour, minute] = value.split(":").map(Number)
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? value : null
}

export function normalizePartySize(value: string | null | undefined) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : null
}

function timeToMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number)
  return hour * 60 + minute
}

export function orderAvailabilitySlots(slots: string[], preferredTime: string | null) {
  const uniqueSlots = Array.from(new Set(slots))
  if (!preferredTime) return uniqueSlots.sort()
  const preferredMinutes = timeToMinutes(preferredTime)
  return uniqueSlots.sort((left, right) => {
    const leftMinutes = timeToMinutes(left)
    const rightMinutes = timeToMinutes(right)
    const leftExact = left === preferredTime ? 0 : 1
    const rightExact = right === preferredTime ? 0 : 1
    if (leftExact !== rightExact) return leftExact - rightExact
    const distance = Math.abs(leftMinutes - preferredMinutes) - Math.abs(rightMinutes - preferredMinutes)
    if (distance !== 0) return distance
    return leftMinutes - rightMinutes
  })
}

export function lastAvailabilitySlots(slots: string[], limit = 3) {
  const normalizedLimit = Math.max(0, Math.floor(limit))
  if (normalizedLimit === 0) return []
  return orderAvailabilitySlots(slots, null).slice(-normalizedLimit)
}
