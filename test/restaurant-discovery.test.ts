import { describe, expect, it } from "vitest"
import {
  RESTAURANT_DISCOVERY_PAGE_SIZE,
  getRestaurantDiscoveryScore,
  parseRestaurantDiscoveryQuery,
} from "@/lib/restaurant-discovery"

describe("restaurant discovery query parsing", () => {
  it("uses safe defaults and the fixed page size", () => {
    expect(parseRestaurantDiscoveryQuery()).toEqual({
      page: 1,
      pageSize: RESTAURANT_DISCOVERY_PAGE_SIZE,
    })
  })

  it("normalizes filters, accepts supported cuisine presets, and resets invalid pages", () => {
    expect(parseRestaurantDiscoveryQuery({
      q: "  seafood   bodrum  ",
      location: ["Bodrum", "Ignored"],
      cuisine: "seaFOOD",
      atmosphere: "  Relaxing ",
      page: "not-a-page",
    })).toEqual({
      q: "seafood bodrum",
      location: "Bodrum",
      cuisine: "Seafood",
      atmosphere: "Relaxing",
      page: 1,
      pageSize: RESTAURANT_DISCOVERY_PAGE_SIZE,
    })
  })

  it("does not allow an unsupported cuisine value into the query", () => {
    expect(parseRestaurantDiscoveryQuery({ cuisine: "pricey" }).cuisine).toBeUndefined()
  })

  it("caps long filters and page numbers", () => {
    const query = parseRestaurantDiscoveryQuery({ q: "a".repeat(120), page: "99999" })
    expect(query.q).toHaveLength(80)
    expect(query.page).toBe(1000)
  })
})

describe("restaurant discovery scoring", () => {
  it("rewards complete profiles deterministically", () => {
    const complete = {
      primaryImageUrl: "/restaurant.jpg",
      logoUrl: "/logo.png",
      description: "A warm dining room.",
      cuisine: "Seafood",
      atmosphere: "Relaxing",
      hours: "12:00–22:00",
      location: "Bodrum",
      menuUrl: "https://example.com/menu",
    }
    const minimal = {
      primaryImageUrl: null,
      logoUrl: null,
      description: null,
      cuisine: "Seafood",
      atmosphere: null,
      hours: null,
      location: null,
      menuUrl: null,
    }

    expect(getRestaurantDiscoveryScore(complete)).toBeGreaterThan(getRestaurantDiscoveryScore(minimal))
    expect(getRestaurantDiscoveryScore(complete)).toBe(12)
    expect(getRestaurantDiscoveryScore(minimal)).toBe(1)
  })
})

