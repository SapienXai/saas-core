import { describe, expect, it } from "vitest"

import { resolveRestaurantImportTargets, validatePlatformRestaurantProfileInput } from "@/lib/platform-admin"
import { normalizeOfficialWebsiteUrl } from "@/lib/claimable-restaurants"
import type { ParsedRestaurantImportRow } from "@/lib/platform-restaurant-import"

const baseInput = {
  name: "Mikla Istanbul",
  businessContactEmail: "owner@example.com",
  officialWebsiteUrl: "https://example.com",
}

describe("platform restaurant profile validation", () => {
  it("normalizes a bare official domain to an https website URL", () => {
    expect(normalizeOfficialWebsiteUrl(" felixsmile.com ")).toBe("https://felixsmile.com")
  })

  it("accepts a compact website-imported profile", () => {
    expect(validatePlatformRestaurantProfileInput({
      ...baseInput,
      description: "Modern Anatolian tasting menu with sweeping rooftop views over Istanbul",
      socialLinks: {
        instagram: "https://instagram.com/mikla",
        facebook: "https://facebook.com/mikla",
      },
      allowed_days_of_week: [1, 2, 3, 4, 5],
      min_party_size: 1,
      max_party_size: 12,
    }).socialLinks).toMatchObject({ instagram: "https://instagram.com/mikla" })
  })

  it("rejects names and descriptions that are too long", () => {
    expect(() => validatePlatformRestaurantProfileInput({ ...baseInput, name: "One Two Three Four" })).toThrow("3 words")
    expect(() => validatePlatformRestaurantProfileInput({ ...baseInput, description: "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen" })).toThrow("15 words")
  })

  it("rejects invalid social links and more than four social networks", () => {
    expect(() => validatePlatformRestaurantProfileInput({ ...baseInput, socialLinks: { instagram: "not-a-url" } })).toThrow("Instagram")
    expect(() => validatePlatformRestaurantProfileInput({
      ...baseInput,
      socialLinks: {
        instagram: "https://instagram.com/mikla",
        facebook: "https://facebook.com/mikla",
        tiktok: "https://tiktok.com/@mikla",
        youtube: "https://youtube.com/@mikla",
        x: "https://x.com/mikla",
      },
    })).toThrow("4 social links")
  })

  it("rejects an impossible reservation rule set", () => {
    expect(() => validatePlatformRestaurantProfileInput({ ...baseInput, allowed_days_of_week: [], min_party_size: 8, max_party_size: 4 })).toThrow("reservation day")
    expect(() => validatePlatformRestaurantProfileInput({ ...baseInput, min_party_size: 8, max_party_size: 4 })).toThrow("smaller")
  })
})

describe("platform restaurant import update matching", () => {
  const row = (overrides: Partial<ParsedRestaurantImportRow["payload"]> = {}, excelRowNumber = 2): ParsedRestaurantImportRow => ({
    excelRowNumber,
    payload: {
      name: "Updated House",
      business_contact_email: "owner@updated.example",
      official_website_url: "https://updated.example",
      official_domain: "updated.example",
      slug: "updated-house",
      ...overrides,
    },
    providedFields: ["name", "business_contact_email", "official_website_url", "official_domain", "slug"],
    status: "ready",
    messages: [],
  })

  const restaurants = [
    { id: "restaurant-1", name: "Updated House", slug: "updated-house", workspace_id: "workspace-1" },
    { id: "restaurant-2", name: "Legacy House", slug: "legacy-house", workspace_id: "workspace-2" },
  ]

  it("matches only platform-created restaurants and prefers the public slug", () => {
    const [matched, legacy] = resolveRestaurantImportTargets(
      [row(), row({ name: "Legacy House", business_contact_email: "legacy@legacy.example", slug: "legacy-house" })],
      restaurants,
      [
        { restaurant_id: "restaurant-1", source: "platform_excel", normalized_business_contact_email: "owner@updated.example" },
        { restaurant_id: "restaurant-2", source: "self_service", normalized_business_contact_email: "legacy@legacy.example" },
      ],
    )
    expect(matched).toMatchObject({ targetRestaurantId: "restaurant-1", matchMethod: "public_slug", matchName: "Updated House", status: "ready" })
    expect(legacy.status).toBe("error")
    expect(legacy.messages.join(" ")).toContain("No existing platform restaurant matched")
  })

  it("falls back to a unique platform business email without changing the existing slug", () => {
    const [matched] = resolveRestaurantImportTargets(
      [row({ slug: "new-spelling" })],
      restaurants,
      [{ restaurant_id: "restaurant-1", source: "platform_manual", normalized_business_contact_email: "owner@updated.example" }],
    )
    expect(matched).toMatchObject({ targetRestaurantId: "restaurant-1", matchMethod: "business_email", matchName: "Updated House", status: "warning" })
    expect(matched.messages.join(" ")).toContain("existing slug will be preserved")
  })

  it("rejects duplicate workbook rows that would update the same restaurant twice", () => {
    const rows = resolveRestaurantImportTargets(
      [row(), row({}, 3)],
      restaurants,
      [{ restaurant_id: "restaurant-1", source: "platform_excel", normalized_business_contact_email: "owner@updated.example" }],
    )
    expect(rows.every((item) => item.status === "error")).toBe(true)
    expect(rows[0].messages.join(" ")).toContain("same existing restaurant")
  })
})
