import type { Restaurant } from "@/types/supabase"
import { getSafeRestaurantAssetUrl } from "@/lib/legacy-assets"

export const RESERVED_RESTAURANT_SLUGS = new Set([
  "www",
  "app",
  "api",
  "mcp",
  "docs",
  "admin",
  "manage",
  "login",
  "signup",
  "pricing",
  "help",
  "support",
  "status",
  "mail",
  "assets",
  "static",
])

export const SOCIAL_PLATFORMS = ["instagram", "facebook", "tiktok", "youtube", "x", "website"] as const
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number]
export type RestaurantSocialLinks = Partial<Record<SocialPlatform, string>>

export const SOCIAL_PLATFORM_LABELS: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X",
  website: "Website",
}

export const PROFILE_VISIBILITY_KEYS = [
  "logo",
  "banner",
  "description",
  "cuisine",
  "hours",
  "atmosphere",
  "phone",
  "whatsapp",
  "location",
  "menu",
  "events",
  "social",
  "reserve",
] as const

export type RestaurantProfileVisibilityKey = (typeof PROFILE_VISIBILITY_KEYS)[number]
export type RestaurantProfileVisibility = Partial<Record<RestaurantProfileVisibilityKey, boolean>>

export const DEFAULT_PROFILE_VISIBILITY: Record<RestaurantProfileVisibilityKey, boolean> = {
  logo: true,
  banner: true,
  description: true,
  cuisine: true,
  hours: true,
  atmosphere: true,
  phone: true,
  whatsapp: true,
  location: true,
  menu: true,
  events: true,
  social: true,
  reserve: true,
}

export function normalizeProfileVisibility(value: unknown): Record<RestaurantProfileVisibilityKey, boolean> {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

  const visibility = PROFILE_VISIBILITY_KEYS.reduce((result, key) => {
    result[key] = source[key] === undefined ? DEFAULT_PROFILE_VISIBILITY[key] : source[key] === true
    return result
  }, {} as Record<RestaurantProfileVisibilityKey, boolean>)

  // Logo and banner are core profile artwork, not optional public fields.
  visibility.logo = true
  visibility.banner = true
  return visibility
}

export type RestaurantProfileInput = {
  name: string
  slug?: string
  logo_url?: string | null
  primary_image_url?: string | null
  description?: string | null
  cuisine?: string | null
  atmosphere?: string | null
  hours?: string | null
  location?: string | null
  phone?: string | null
  whatsapp?: string | null
  menu_url?: string | null
  location_url?: string | null
  events_url?: string | null
  social_links?: RestaurantSocialLinks | null
  profile_visibility?: RestaurantProfileVisibility | null
  timezone?: string | null
  language?: string | null
  address_line1?: string | null
  address_line2?: string | null
  address_locality?: string | null
  address_region?: string | null
  address_postal_code?: string | null
  address_country?: string | null
  latitude?: number | null
  longitude?: number | null
  official_website_url?: string | null
  status?: "published" | "unpublished"
}

export type PublicRestaurantProfile = {
  restaurantId: string | null
  slug: string
  name: string
  updatedAt: string | null
  logoUrl: string | null
  primaryImageUrl: string | null
  description: string | null
  cuisine: string | null
  atmosphere: string | null
  hours: string | null
  phone: string | null
  whatsapp: string | null
  menuUrl: string | null
  locationUrl: string | null
  eventsUrl: string | null
  socialLinks: RestaurantSocialLinks
  visibility: Record<RestaurantProfileVisibilityKey, boolean>
  location: string | null
  address: {
    line1: string | null
    line2: string | null
    locality: string | null
    region: string | null
    postalCode: string | null
    country: string | null
    formatted: string | null
  }
  latitude: number | null
  longitude: number | null
  officialWebsiteUrl: string | null
  reservationStartDate: string | null
  timezone: string
  language: string
  isPublished: boolean
  reservationEnabled: boolean
  showReserveviaBranding: boolean
  isClaimable: boolean
}

const TRANSLITERATION_MAP: Record<string, string> = {
  ı: "i",
  İ: "I",
  ş: "s",
  Ş: "S",
  ğ: "g",
  Ğ: "G",
  ç: "c",
  Ç: "C",
  ö: "o",
  Ö: "O",
  ü: "u",
  Ü: "U",
  ß: "ss",
  æ: "ae",
  Æ: "AE",
}

function transliterate(value: string) {
  return value
    .split("")
    .map((character) => TRANSLITERATION_MAP[character] ?? character)
    .join("")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

export function slugifyRestaurantName(value: string) {
  const slug = transliterate(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)

  return slug || "restaurant"
}

/**
 * Keeps a generated public slug within the database's 63-character limit.
 * This is used after a collision so imported profiles remain publishable.
 */
export function appendRestaurantSlugSuffix(baseSlug: string, suffix: number) {
  const normalizedBase = baseSlug.trim().toLowerCase().replace(/-+$/g, "") || "restaurant"
  const suffixText = `-${suffix}`
  const maxBaseLength = Math.max(1, 63 - suffixText.length)
  return `${normalizedBase.slice(0, maxBaseLength).replace(/-+$/g, "")}${suffixText}`
}

export function isRestaurantSlug(value: string) {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value)
}

export function validateRestaurantSlug(value: string, currentSlug?: string | null) {
  const slug = value.trim().toLowerCase()
  if (!slug) return "A public slug is required."
  if (!isRestaurantSlug(slug)) {
    return "Use lowercase letters, numbers, and single hyphens only."
  }
  if (RESERVED_RESTAURANT_SLUGS.has(slug) && slug !== currentSlug) {
    return "That public slug is reserved by Reservevia."
  }
  return null
}

export function validateOptionalPublicUrl(value: string | null | undefined, label: string) {
  if (!value?.trim()) return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return `${label} must be an http(s) URL.`
    }
  } catch {
    return `${label} must be a valid URL.`
  }
  return null
}

export function validateSocialLinks(value: RestaurantSocialLinks | null | undefined) {
  for (const platform of SOCIAL_PLATFORMS) {
    const urlError = validateOptionalPublicUrl(value?.[platform], SOCIAL_PLATFORM_LABELS[platform])
    if (urlError) return urlError
  }
  return null
}

export function normalizeSocialLinks(value: unknown): RestaurantSocialLinks {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}

  const links: RestaurantSocialLinks = {}
  for (const platform of SOCIAL_PLATFORMS) {
    const candidate = (value as Record<string, unknown>)[platform]
    if (typeof candidate !== "string" || !candidate.trim()) continue
    if (!validateOptionalPublicUrl(candidate, SOCIAL_PLATFORM_LABELS[platform])) {
      links[platform] = candidate.trim()
    }
  }
  return links
}

function getLegacyLocationUrl(value: string | null) {
  if (!value?.trim() || validateOptionalPublicUrl(value, "Location") || !/^https?:\/\//i.test(value.trim())) return null
  return value.trim()
}

export function toPublicRestaurantProfile(
  restaurant: Pick<Restaurant, "name" | "slug" | "logo_url" | "primary_image_url" | "description" | "cuisine" | "atmosphere" | "hours" | "phone" | "whatsapp" | "menu_url" | "location_url" | "events_url" | "social_links" | "profile_visibility" | "location" | "timezone" | "language" | "status" | "reservation_enabled" | "reservation_start_date"> & Partial<Pick<Restaurant, "address_line1" | "address_line2" | "address_locality" | "address_region" | "address_postal_code" | "address_country" | "latitude" | "longitude" | "official_website_url">> & { updated_at?: string | null },
  options: { showReserveviaBranding?: boolean; restaurantId?: string | null; isClaimable?: boolean } = {},
): PublicRestaurantProfile {
  const legacyLocationUrl = restaurant.location_url || getLegacyLocationUrl(restaurant.location)
  const visibility = normalizeProfileVisibility(restaurant.profile_visibility)
  return {
    restaurantId: options.restaurantId ?? null,
    slug: restaurant.slug,
    name: restaurant.name,
    updatedAt: restaurant.updated_at ?? null,
    logoUrl: visibility.logo ? getSafeRestaurantAssetUrl(restaurant.logo_url) : null,
    primaryImageUrl: visibility.banner ? getSafeRestaurantAssetUrl(restaurant.primary_image_url) : null,
    description: visibility.description ? restaurant.description : null,
    cuisine: visibility.cuisine ? restaurant.cuisine : null,
    atmosphere: visibility.atmosphere ? restaurant.atmosphere : null,
    hours: visibility.hours ? restaurant.hours : null,
    phone: visibility.phone ? restaurant.phone : null,
    whatsapp: visibility.whatsapp ? restaurant.whatsapp : null,
    menuUrl: visibility.menu ? restaurant.menu_url : null,
    locationUrl: visibility.location ? legacyLocationUrl : null,
    eventsUrl: visibility.events ? restaurant.events_url : null,
    socialLinks: visibility.social ? normalizeSocialLinks(restaurant.social_links) : {},
    visibility,
    location: visibility.location ? restaurant.location : null,
    address: {
      line1: visibility.location ? restaurant.address_line1 ?? null : null,
      line2: visibility.location ? restaurant.address_line2 ?? null : null,
      locality: visibility.location ? restaurant.address_locality ?? null : null,
      region: visibility.location ? restaurant.address_region ?? null : null,
      postalCode: visibility.location ? restaurant.address_postal_code ?? null : null,
      country: visibility.location ? restaurant.address_country ?? null : null,
      formatted: visibility.location ? [restaurant.address_line1, restaurant.address_line2, restaurant.address_locality, restaurant.address_region, restaurant.address_postal_code, restaurant.address_country].filter(Boolean).join(", ") || restaurant.location : null,
    },
    latitude: restaurant.latitude ?? null,
    longitude: restaurant.longitude ?? null,
    officialWebsiteUrl: restaurant.official_website_url || normalizeSocialLinks(restaurant.social_links).website || null,
    reservationStartDate: restaurant.reservation_start_date,
    timezone: restaurant.timezone,
    language: restaurant.language,
    isPublished: restaurant.status === "published",
    reservationEnabled: visibility.reserve && restaurant.reservation_enabled === true,
    showReserveviaBranding: options.showReserveviaBranding ?? true,
    isClaimable: options.isClaimable ?? false,
  }
}
