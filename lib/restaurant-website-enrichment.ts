import "server-only"

import { createServiceRoleClient } from "@/lib/supabase"
import { normalizeBusinessEmail, normalizeOfficialDomain } from "@/lib/claimable-restaurants"
import { normalizeSocialLinks, type RestaurantSocialLinks } from "@/lib/restaurant-profile"
import type { WebsiteImportProfile } from "@/lib/website-import"

const ENRICHABLE_RESTAURANT_FIELDS = [
  "description",
  "cuisine",
  "atmosphere",
  "hours",
  "location",
  "phone",
  "whatsapp",
  "menu_url",
  "location_url",
  "events_url",
  "address_line1",
  "address_line2",
  "address_locality",
  "address_region",
  "address_postal_code",
  "address_country",
  "latitude",
  "longitude",
  "official_website_url",
] as const

type EnrichableRestaurantField = (typeof ENRICHABLE_RESTAURANT_FIELDS)[number]

export type ExistingRestaurantWebsiteProfile = {
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
  address_line1?: string | null
  address_line2?: string | null
  address_locality?: string | null
  address_region?: string | null
  address_postal_code?: string | null
  address_country?: string | null
  latitude?: number | null
  longitude?: number | null
  official_website_url?: string | null
  social_links?: unknown
}

export type ExistingRestaurantClaimProfile = {
  business_contact_email?: string | null
  official_domain?: string | null
}

export type RestaurantWebsiteUpdatePlan = {
  restaurantUpdates: Record<string, unknown>
  claimProfileUpdates: Record<string, unknown>
  updatedFields: string[]
}

export type RestaurantWebsiteEnrichmentResult = {
  success: boolean
  updatedFields: string[]
  skippedFields: string[]
  message?: string
}

function isMissing(value: unknown) {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "")
}

function addMissingField(
  updates: Record<string, unknown>,
  updatedFields: string[],
  field: EnrichableRestaurantField,
  current: unknown,
  discovered: unknown,
) {
  if (!isMissing(current) || isMissing(discovered)) return
  updates[field] = discovered
  updatedFields.push(field)
}

export function planMissingRestaurantWebsiteUpdates(input: {
  restaurant: ExistingRestaurantWebsiteProfile
  claimProfile?: ExistingRestaurantClaimProfile | null
  discovered: WebsiteImportProfile
  sourceUrl?: string
}): RestaurantWebsiteUpdatePlan {
  const restaurantUpdates: Record<string, unknown> = {}
  const claimProfileUpdates: Record<string, unknown> = {}
  const updatedFields: string[] = []

  for (const field of ENRICHABLE_RESTAURANT_FIELDS) {
    addMissingField(restaurantUpdates, updatedFields, field, input.restaurant[field], input.discovered[field])
  }

  const existingSocialLinks = normalizeSocialLinks(input.restaurant.social_links)
  const discoveredSocialLinks = normalizeSocialLinks(input.discovered.social_links)
  const mergedSocialLinks: RestaurantSocialLinks = { ...existingSocialLinks }
  let socialLinkCount = Object.entries(existingSocialLinks).filter(([platform]) => platform !== "website").length
  for (const [platform, url] of Object.entries(discoveredSocialLinks)) {
    if (!url || mergedSocialLinks[platform as keyof RestaurantSocialLinks]) continue
    if (platform !== "website" && socialLinkCount >= 4) continue
    mergedSocialLinks[platform as keyof RestaurantSocialLinks] = url
    if (platform !== "website") socialLinkCount += 1
    updatedFields.push(`social_links.${platform}`)
  }
  if (Object.keys(mergedSocialLinks).length > Object.keys(existingSocialLinks).length) {
    restaurantUpdates.social_links = mergedSocialLinks
  }

  const discoveredEmail = normalizeBusinessEmail(input.discovered.business_contact_email)
  if (isMissing(input.claimProfile?.business_contact_email) && discoveredEmail) {
    claimProfileUpdates.business_contact_email = discoveredEmail
    claimProfileUpdates.normalized_business_contact_email = discoveredEmail
    updatedFields.push("business_contact_email")
  }

  const derivedDomain = normalizeOfficialDomain(input.sourceUrl)
  if (isMissing(input.claimProfile?.official_domain) && derivedDomain) {
    claimProfileUpdates.official_domain = derivedDomain
    updatedFields.push("official_domain")
  }

  if (isMissing(input.restaurant.social_links) && input.sourceUrl && !restaurantUpdates.social_links) {
    restaurantUpdates.social_links = { website: input.sourceUrl }
    updatedFields.push("social_links.website")
  }

  return { restaurantUpdates, claimProfileUpdates, updatedFields }
}

export async function enrichRestaurantWebsiteProfile(input: {
  restaurantId: string
  discovered: WebsiteImportProfile
  sourceUrl: string
}): Promise<RestaurantWebsiteEnrichmentResult> {
  const service = createServiceRoleClient()
  const [{ data: restaurant, error: restaurantError }, { data: claimProfile, error: claimProfileError }] = await Promise.all([
    service.from("restaurants").select("description, cuisine, atmosphere, hours, location, phone, whatsapp, menu_url, location_url, events_url, address_line1, address_line2, address_locality, address_region, address_postal_code, address_country, latitude, longitude, official_website_url, social_links").eq("id", input.restaurantId).maybeSingle(),
    service.from("restaurant_claim_profiles").select("business_contact_email, official_domain").eq("restaurant_id", input.restaurantId).maybeSingle(),
  ])
  if (restaurantError) throw new Error(restaurantError.message)
  if (claimProfileError) throw new Error(claimProfileError.message)
  if (!restaurant) throw new Error("Restaurant not found.")

  const plan = planMissingRestaurantWebsiteUpdates({ restaurant, claimProfile, discovered: input.discovered, sourceUrl: input.sourceUrl })
  const skippedFields: string[] = []

  if (plan.claimProfileUpdates.normalized_business_contact_email) {
    const { data: duplicate, error: duplicateError } = await service
      .from("restaurant_claim_profiles")
      .select("restaurant_id")
      .eq("normalized_business_contact_email", plan.claimProfileUpdates.normalized_business_contact_email)
      .neq("restaurant_id", input.restaurantId)
      .limit(1)
      .maybeSingle()
    if (duplicateError) throw new Error(duplicateError.message)
    if (duplicate) {
      delete plan.claimProfileUpdates.business_contact_email
      delete plan.claimProfileUpdates.normalized_business_contact_email
      const emailIndex = plan.updatedFields.indexOf("business_contact_email")
      if (emailIndex >= 0) plan.updatedFields.splice(emailIndex, 1)
      skippedFields.push("business_contact_email")
    }
  }

  if (Object.keys(plan.restaurantUpdates).length > 0) {
    const { error } = await service.from("restaurants").update(plan.restaurantUpdates).eq("id", input.restaurantId)
    if (error) throw new Error(error.message)
  }
  if (Object.keys(plan.claimProfileUpdates).length > 0) {
    const { error } = await service.from("restaurant_claim_profiles").update(plan.claimProfileUpdates).eq("restaurant_id", input.restaurantId)
    if (error) throw new Error(error.message)
  }

  return { success: true, updatedFields: plan.updatedFields, skippedFields }
}
