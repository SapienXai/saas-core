import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { RestaurantStructuredData } from "@/components/restaurant-structured-data"
import { getRestaurantAiReadiness } from "@/lib/ai/readiness"
import { apiErrorBody, availabilitySchema, parseApiSchema, reservationCreateSchema } from "@/lib/ai/contracts"
import { toPublicRestaurantDto } from "@/lib/ai/restaurant-directory"

const restaurant = {
  restaurantId: "00000000-0000-4000-8000-000000000001",
  slug: "harbor-house",
  name: "Harbor House <script>alert(1)</script>",
  updatedAt: "2026-08-14T10:00:00.000Z",
  logoUrl: "https://example.test/logo.png",
  primaryImageUrl: "https://example.test/hero.png",
  description: "A safe public description.",
  cuisine: "Seafood",
  atmosphere: "Calm",
  hours: "Daily 12:00-22:00",
  phone: "+905555555555",
  whatsapp: null,
  menuUrl: "https://example.test/menu",
  locationUrl: "https://maps.google.com/?q=harbor",
  eventsUrl: null,
  socialLinks: { website: "https://example.test" },
  visibility: {} as never,
  location: "Istanbul",
  address: { line1: "Example Street 1", line2: null, locality: "Istanbul", region: null, postalCode: "34000", country: "TR", formatted: "Example Street 1, Istanbul, 34000, TR" },
  latitude: 41.0082,
  longitude: 28.9784,
  officialWebsiteUrl: "https://example.test",
  reservationStartDate: null,
  timezone: "Europe/Istanbul",
  language: "en",
  isPublished: true,
  reservationEnabled: true,
  showReserveviaBranding: true,
  isClaimable: false,
}

describe("AI-native restaurant contracts", () => {
  it("reports strict feed readiness without fabricating missing fields", () => {
    const ready = getRestaurantAiReadiness({
      id: restaurant.restaurantId,
      slug: restaurant.slug,
      name: restaurant.name,
      location: restaurant.location,
      address_line1: restaurant.address.line1,
      address_locality: restaurant.address.locality,
      address_country: restaurant.address.country,
      latitude: restaurant.latitude,
      longitude: restaurant.longitude,
      phone: restaurant.phone,
      official_website_url: restaurant.officialWebsiteUrl,
      timezone: restaurant.timezone,
      status: "published",
      platform_status: "active",
      reservation_enabled: true,
    })
    expect(ready.eligible).toBe(true)
    const incomplete = getRestaurantAiReadiness({ id: restaurant.restaurantId, slug: restaurant.slug, name: restaurant.name, status: "published", platform_status: "active", reservation_enabled: true })
    expect(incomplete.eligible).toBe(false)
    expect(incomplete.missing).toEqual(expect.arrayContaining(["latitude", "longitude", "phone_number", "official_website_url"]))
  })

  it("escapes restaurant-authored JSON-LD data and includes booking metadata", () => {
    const html = renderToStaticMarkup(<RestaurantStructuredData restaurant={restaurant} canonicalUrl="https://reservevia.test/r/harbor-house" />)
    expect(html).toContain("Restaurant")
    expect(html).toContain("ReserveAction")
    expect(html).toContain("acceptsReservations")
    expect(html).toContain("\\u003cscript")
    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("GeoCoordinates")
  })

  it("validates API inputs with shared schemas", () => {
    expect(parseApiSchema(availabilitySchema, { restaurant_id: restaurant.restaurantId, date: "2026-08-15", party_size: 4 }).party_size).toBe(4)
    expect(() => parseApiSchema(availabilitySchema, { restaurant_id: "not-a-uuid", date: "tomorrow", party_size: 0 })).toThrow()
    expect(reservationCreateSchema.safeParse({ restaurant_id: restaurant.restaurantId, date: "2026-08-15", time: "20:00", party_size: 4, guest: { name: "Alex" } }).success).toBe(true)
  })

  it("keeps public DTOs and errors free of private implementation details", () => {
    const dto = toPublicRestaurantDto({ id: restaurant.restaurantId, slug: restaurant.slug, name: restaurant.name, location: restaurant.location, address_line1: restaurant.address.line1, address_locality: restaurant.address.locality, address_country: restaurant.address.country, latitude: restaurant.latitude, longitude: restaurant.longitude, phone: restaurant.phone, official_website_url: restaurant.officialWebsiteUrl, timezone: restaurant.timezone, reservation_enabled: true, workspace_id: "private-workspace", status: "published", platform_status: "active" })
    expect(dto).not.toHaveProperty("workspace_id")
    expect(dto).not.toHaveProperty("customer_email")
    expect(dto).not.toHaveProperty("management_token")
    const error = apiErrorBody(new Error("SQLSTATE 42501 from Supabase"), "request-1")
    expect(JSON.stringify(error)).not.toContain("SQLSTATE")
    expect(JSON.stringify(error)).not.toContain("Supabase")
  })
})
