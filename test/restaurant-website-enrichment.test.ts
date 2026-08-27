import { describe, expect, it } from "vitest"

import { planMissingRestaurantWebsiteUpdates } from "@/lib/restaurant-website-enrichment"

const discovered = {
  name: "Harbor House",
  slug: "harbor-house",
  business_contact_email: "info@harborhouse.example",
  logo_url: "https://harborhouse.example/logo.png",
  primary_image_url: "https://harborhouse.example/hero.jpg",
  description: "Website description that must not replace an explicit workbook value.",
  cuisine: "Mediterranean",
  atmosphere: "Relaxed",
  hours: "Daily · 17:00–23:00",
  location: "Marina district",
  phone: "+90 252 000 00 00",
  whatsapp: "+90 252 000 00 00",
  menu_url: "https://harborhouse.example/menu",
  location_url: "https://maps.google.com/?q=harbor-house",
  events_url: "https://harborhouse.example/events",
  social_links: {
    website: "https://harborhouse.example",
    instagram: "https://instagram.com/harborhouse",
    facebook: "https://facebook.com/harborhouse",
  },
  timezone: "UTC",
  language: "en",
}

describe("restaurant website enrichment planning", () => {
  it("fills only missing profile fields and merges missing social links", () => {
    const plan = planMissingRestaurantWebsiteUpdates({
      restaurant: {
        description: "Explicit workbook description",
        cuisine: null,
        atmosphere: "Explicit atmosphere",
        hours: null,
        location: null,
        phone: null,
        whatsapp: null,
        menu_url: null,
        location_url: null,
        events_url: null,
        social_links: { instagram: "https://instagram.com/explicit" },
      },
      claimProfile: { business_contact_email: null },
      discovered,
      sourceUrl: "https://harborhouse.example",
    })

    expect(plan.restaurantUpdates).toMatchObject({
      cuisine: "Mediterranean",
      hours: "Daily · 17:00–23:00",
      location: "Marina district",
      phone: "+90 252 000 00 00",
      whatsapp: "+90 252 000 00 00",
      menu_url: "https://harborhouse.example/menu",
      location_url: "https://maps.google.com/?q=harbor-house",
      events_url: "https://harborhouse.example/events",
      social_links: {
        instagram: "https://instagram.com/explicit",
        website: "https://harborhouse.example",
        facebook: "https://facebook.com/harborhouse",
      },
    })
    expect(plan.restaurantUpdates).not.toHaveProperty("description")
    expect(plan.restaurantUpdates).not.toHaveProperty("atmosphere")
    expect(plan.claimProfileUpdates).toEqual({
      business_contact_email: "info@harborhouse.example",
      normalized_business_contact_email: "info@harborhouse.example",
      official_domain: "harborhouse.example",
    })
    expect(plan.updatedFields).toContain("business_contact_email")
  })

  it("does not replace existing business contact or profile links", () => {
    const plan = planMissingRestaurantWebsiteUpdates({
      restaurant: { social_links: { website: "https://operator.example" } },
      claimProfile: { business_contact_email: "owner@operator.example", official_domain: "operator.example" },
      discovered,
      sourceUrl: "https://harborhouse.example",
    })

    expect(plan.claimProfileUpdates).toEqual({})
    expect(plan.restaurantUpdates.social_links).toEqual({
      website: "https://operator.example",
      instagram: "https://instagram.com/harborhouse",
      facebook: "https://facebook.com/harborhouse",
    })
    expect(plan.updatedFields).not.toContain("business_contact_email")
  })
})
