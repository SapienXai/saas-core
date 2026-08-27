import "server-only"

import { createServiceRoleClient } from "@/lib/supabase"
import { normalizeBusinessEmail, normalizeOfficialDomain, normalizeOfficialWebsiteUrl, type ClaimSource, type ClaimOwnershipStatus } from "@/lib/claimable-restaurants"

export type ProvisionRestaurantInput = {
  restaurantName: string
  workspaceName?: string | null
  workspaceId?: string | null
  restaurantSlug?: string | null
  ownerUserId?: string | null
  restaurantStatus?: "published" | "unpublished"
  ownershipStatus?: ClaimOwnershipStatus
  source?: ClaimSource
  businessContactEmail?: string | null
  officialWebsiteUrl?: string | null
  officialDomain?: string | null
  sourceImportId?: string | null
  description?: string | null
  cuisine?: string | null
  location?: string | null
  phone?: string | null
  hours?: string | null
  atmosphere?: string | null
  timezone?: string | null
  language?: string | null
  reservation_enabled?: boolean
  opening_time?: string | null
  closing_time?: string | null
  time_slot_duration?: number
  advance_booking_days?: number
  min_advance_hours?: number
  min_party_size?: number
  max_party_size?: number
  meal_only_reservations?: boolean
  media_type?: "slideshow" | "video" | null
  allowed_days_of_week?: number[]
  reservation_start_date?: string | null
  reservation_blocked_intervals?: Array<{ date: string; start_time: string; end_time: string; message?: string }>
  reservation_notices?: unknown[]
  addressLine1?: string | null
  addressLine2?: string | null
  addressLocality?: string | null
  addressRegion?: string | null
  addressPostalCode?: string | null
  addressCountry?: string | null
  latitude?: number | null
  longitude?: number | null
}

export async function provisionRestaurantWorkspace(input: ProvisionRestaurantInput) {
  const restaurantName = input.restaurantName.trim()
  if (!restaurantName) throw new Error("Restaurant name is required.")

  const { data, error } = await createServiceRoleClient().rpc("provision_restaurant_workspace", {
    target_restaurant_name: restaurantName,
    target_workspace_name: input.workspaceName?.trim() || null,
    target_restaurant_slug: input.restaurantSlug?.trim().toLowerCase() || null,
    target_workspace_id: input.workspaceId || null,
    target_owner_user_id: input.ownerUserId || null,
    target_restaurant_status: input.restaurantStatus || "unpublished",
    target_claim_status: input.ownershipStatus || "claimed",
    target_source: input.source || "self_service",
    target_business_contact_email: normalizeBusinessEmail(input.businessContactEmail),
    target_official_website_url: normalizeOfficialWebsiteUrl(input.officialWebsiteUrl),
    target_official_domain: normalizeOfficialDomain(input.officialDomain || input.officialWebsiteUrl),
    target_source_import_id: input.sourceImportId || null,
    target_profile: {
      description: input.description || null,
      cuisine: input.cuisine || null,
      location: input.location || null,
      phone: input.phone || null,
      hours: input.hours || null,
      atmosphere: input.atmosphere || null,
      timezone: input.timezone || null,
      language: input.language || null,
      media_type: input.media_type || null,
      reservation_enabled: input.reservation_enabled,
      opening_time: input.opening_time || null,
      closing_time: input.closing_time || null,
      time_slot_duration: input.time_slot_duration,
      advance_booking_days: input.advance_booking_days,
      min_advance_hours: input.min_advance_hours,
      min_party_size: input.min_party_size,
      max_party_size: input.max_party_size,
      meal_only_reservations: input.meal_only_reservations,
      allowed_days_of_week: input.allowed_days_of_week,
      reservation_start_date: input.reservation_start_date || null,
      reservation_blocked_intervals: input.reservation_blocked_intervals || [],
      reservation_notices: input.reservation_notices || [],
    },
  } as any)
  if (error) {
    if (error.message.includes("SLUG_CONFLICT")) throw new Error("SLUG_CONFLICT")
    if (error.message.includes("RESTAURANT_LIMIT_REACHED")) throw new Error("RESTAURANT_LIMIT_REACHED")
    throw new Error(error.message)
  }
  const result = Array.isArray(data) ? data[0] : data
  if (!result?.workspace_id || !result?.restaurant_id) throw new Error("Restaurant provisioning returned no tenant identifiers.")
  const { error: publicProjectionError } = await createServiceRoleClient().from("restaurants").update({
    address_line1: input.addressLine1 || null,
    address_line2: input.addressLine2 || null,
    address_locality: input.addressLocality || null,
    address_region: input.addressRegion || null,
    address_postal_code: input.addressPostalCode || null,
    address_country: input.addressCountry || null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    official_website_url: normalizeOfficialWebsiteUrl(input.officialWebsiteUrl),
  }).eq("id", result.restaurant_id)
  if (publicProjectionError) throw new Error(publicProjectionError.message)
  return result as { workspace_id: string; restaurant_id: string; workspace_slug: string; restaurant_slug: string }
}
