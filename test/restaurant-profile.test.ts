import { describe, expect, it } from "vitest"
import {
  appendRestaurantSlugSuffix,
  isRestaurantSlug,
  normalizeProfileVisibility,
  RESERVED_RESTAURANT_SLUGS,
  normalizeSocialLinks,
  slugifyRestaurantName,
  toPublicRestaurantProfile,
  validateOptionalPublicUrl,
  validateRestaurantSlug,
  validateSocialLinks,
} from "../lib/restaurant-profile"
import { getSafeRestaurantAssetUrl, isValidRestaurantAssetUrl } from "../lib/legacy-assets"

describe("restaurant public profile rules", () => {
  it("creates stable URL-safe slugs without Felix-specific logic", () => {
    expect(slugifyRestaurantName("Şişli Garden & Kitchen")).toBe("sisli-garden-kitchen")
    expect(slugifyRestaurantName("Felix Marina")).toBe("felix-marina")
    expect(isRestaurantSlug("felix-marina")).toBe(true)
    expect(isRestaurantSlug("Felix Marina")).toBe(false)
  })

  it("generates collision-safe public slug alternatives within the URL limit", () => {
    expect(appendRestaurantSlugSuffix("sample-restaurant", 2)).toBe("sample-restaurant-2")
    expect(appendRestaurantSlugSuffix("a".repeat(63), 12)).toHaveLength(63)
    expect(appendRestaurantSlugSuffix("sample-restaurant-", 3)).toBe("sample-restaurant-3")
  })

  it("protects platform-critical reserved slugs", () => {
    expect(RESERVED_RESTAURANT_SLUGS.has("app")).toBe(true)
    expect(validateRestaurantSlug("app")).toContain("reserved")
    expect(validateRestaurantSlug("old-name", "old-name")).toBeNull()
    expect(validateRestaurantSlug("not valid")).toContain("lowercase")
  })

  it("validates optional public links and hides private fields in the public view", () => {
    expect(validateOptionalPublicUrl("https://example.test/menu", "Menu URL")).toBeNull()
    expect(validateOptionalPublicUrl("javascript:alert(1)", "Menu URL")).toContain("http(s)")

    const profile = toPublicRestaurantProfile({
      id: "private-id-not-exposed",
      workspace_id: "private-workspace-not-exposed",
      slug: "sample-restaurant",
      name: "Sample Restaurant",
      logo_url: null,
      primary_image_url: null,
      description: "A concise profile.",
      cuisine: "Mediterranean",
      atmosphere: "Calm",
      hours: "12:00 - 22:00",
      phone: null,
      whatsapp: null,
      menu_url: null,
      location_url: null,
      events_url: null,
      social_links: {
        instagram: " https://instagram.com/sample-restaurant ",
        facebook: "javascript:alert(1)",
        unknown: "https://example.test/ignored",
      },
      location: null,
      timezone: "UTC",
      language: "en",
      status: "published",
      reservation_enabled: true,
    } as never)

    expect(profile.slug).toBe("sample-restaurant")
    expect(toPublicRestaurantProfile({
      name: "Legacy Restaurant",
      slug: "legacy-restaurant",
      logo_url: "/assets/felix.png",
      primary_image_url: "/assets/marina1.jpeg",
      timezone: "UTC",
      language: "en",
      status: "published",
      reservation_enabled: true,
    } as never)).toMatchObject({ logoUrl: null, primaryImageUrl: null })
    expect(profile).not.toHaveProperty("id")
    expect(profile).not.toHaveProperty("workspace_id")
    expect(profile.socialLinks).toEqual({ instagram: "https://instagram.com/sample-restaurant" })
  })

  it("accepts only usable local or http(s) restaurant asset URLs", () => {
    expect(isValidRestaurantAssetUrl("/uploads/cover.webp")).toBe(true)
    expect(isValidRestaurantAssetUrl("https://cdn.example/cover.webp")).toBe(true)
    expect(isValidRestaurantAssetUrl("not-a-url")).toBe(false)
    expect(isValidRestaurantAssetUrl("javascript:alert(1)")).toBe(false)
    expect(isValidRestaurantAssetUrl("/assets/felix.png")).toBe(false)
    expect(getSafeRestaurantAssetUrl("not-a-url")).toBeNull()
    expect(getSafeRestaurantAssetUrl("not-a-url", "/placeholder.svg")).toBe("/placeholder.svg")
  })

  it("accepts only http(s) social links and drops unknown platforms", () => {
    expect(validateSocialLinks({ instagram: "https://instagram.com/sample", website: "javascript:alert(1)" })).toContain("http(s)")
    expect(normalizeSocialLinks({ instagram: "https://instagram.com/sample", x: "ftp://example.test", unknown: "https://example.test" })).toEqual({
      instagram: "https://instagram.com/sample",
    })
  })

  it("keeps profile fields visible by default and preserves explicit switches", () => {
    expect(normalizeProfileVisibility(null).banner).toBe(true)
    expect(normalizeProfileVisibility({ logo: false, banner: false }).logo).toBe(true)
    expect(normalizeProfileVisibility({ logo: false, banner: false }).banner).toBe(true)
    expect(normalizeProfileVisibility({ description: false, social: false }).description).toBe(false)
    expect(normalizeProfileVisibility({ description: false, unknown: true }).social).toBe(true)
  })

  it("removes hidden profile fields from the public projection without deleting source data", () => {
    const profile = toPublicRestaurantProfile({
      name: "Sample Restaurant",
      slug: "sample-restaurant",
      logo_url: "https://example.test/logo.png",
      primary_image_url: "https://example.test/hero.jpg",
      description: "Private from the public view",
      cuisine: "Mediterranean",
      atmosphere: "Calm",
      hours: "12:00 - 22:00",
      phone: "+905555555555",
      whatsapp: "+905555555555",
      menu_url: "https://example.test/menu",
      location_url: "https://maps.google.com/?q=sample",
      events_url: "https://example.test/events",
      social_links: { instagram: "https://instagram.com/sample" },
      profile_visibility: { description: false, phone: false, social: false },
      location: "Istanbul",
      timezone: "Europe/Istanbul",
      language: "tr",
      status: "published",
      reservation_enabled: true,
      reservation_start_date: null,
    })

    expect(profile.description).toBeNull()
    expect(profile.phone).toBeNull()
    expect(profile.socialLinks).toEqual({})
    expect(profile.logoUrl).toBe("https://example.test/logo.png")
    expect(profile.visibility.description).toBe(false)
  })
})
