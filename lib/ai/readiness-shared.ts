export type AiReadinessRestaurant = {
  id: string
  slug: string | null
  name: string | null
  location?: string | null
  address_line1?: string | null
  address_line2?: string | null
  address_locality?: string | null
  address_region?: string | null
  address_postal_code?: string | null
  address_country?: string | null
  latitude?: number | null
  longitude?: number | null
  phone?: string | null
  official_website_url?: string | null
  timezone?: string | null
  status?: string | null
  platform_status?: string | null
  reservation_enabled?: boolean | null
}

export type RestaurantAiReadiness = {
  eligible: boolean
  missing: string[]
  warnings: string[]
  restaurant_id: string
  canonical_url: string | null
  booking_capability: "reservations" | "none"
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function validHttpUrl(value: unknown) {
  if (!hasText(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:"
  } catch {
    return false
  }
}

export function evaluateRestaurantAiReadiness(
  restaurant: AiReadinessRestaurant,
  canonicalUrl: string | null = null,
): RestaurantAiReadiness {
  const address = [
    restaurant.address_line1,
    restaurant.address_line2,
    restaurant.address_locality,
    restaurant.address_region,
    restaurant.address_postal_code,
    restaurant.address_country,
  ].filter(hasText)
  const missing: string[] = []
  const warnings: string[] = []

  if (!hasText(restaurant.id)) missing.push("stable_id")
  if (!hasText(restaurant.name)) missing.push("name")
  if (!hasText(restaurant.slug)) missing.push("slug")
  if (restaurant.status !== "published") missing.push("publication_status")
  if (restaurant.platform_status !== "active") missing.push("platform_status")
  if (restaurant.reservation_enabled !== true) missing.push("booking_capability")
  if (!address.length && !hasText(restaurant.location)) missing.push("formatted_address")
  if (typeof restaurant.latitude !== "number" || typeof restaurant.longitude !== "number") missing.push("latitude", "longitude")
  if (!hasText(restaurant.phone)) missing.push("phone_number")
  if (!validHttpUrl(restaurant.official_website_url)) missing.push("official_website_url")
  if (!canonicalUrl) missing.push("canonical_url")
  if (!hasText(restaurant.timezone)) missing.push("timezone")

  if (!hasText(restaurant.address_locality)) warnings.push("address.locality")
  if (!hasText(restaurant.address_country)) warnings.push("address.country")

  return {
    eligible: missing.length === 0,
    missing: Array.from(new Set(missing)),
    warnings,
    restaurant_id: restaurant.id,
    canonical_url: canonicalUrl,
    booking_capability: restaurant.reservation_enabled === true ? "reservations" : "none",
  }
}
