import { describe, expect, it } from "vitest"

import { getPublicMapCoordinates } from "../lib/public-map"
import {
  lastAvailabilitySlots,
  normalizeAvailabilityDate,
  normalizeAvailabilityTime,
  normalizePartySize,
  orderAvailabilitySlots,
} from "../lib/services/public/brand-service"

describe("public brand booking helpers", () => {
  it("accepts only real calendar dates and bounded party sizes", () => {
    expect(normalizeAvailabilityDate("2026-08-24")).toBe("2026-08-24")
    expect(normalizeAvailabilityDate("2026-02-30")).toBeNull()
    expect(normalizeAvailabilityDate("2026/08/24")).toBeNull()
    expect(normalizePartySize("4")).toBe(4)
    expect(normalizePartySize("0")).toBeNull()
    expect(normalizePartySize("101")).toBeNull()
  })

  it("normalizes optional time filters without accepting malformed input", () => {
    expect(normalizeAvailabilityTime("19:30")).toBe("19:30")
    expect(normalizeAvailabilityTime("7:30")).toBeNull()
    expect(normalizeAvailabilityTime("24:00")).toBeNull()
    expect(normalizeAvailabilityTime("12:60")).toBeNull()
    expect(normalizeAvailabilityTime(null)).toBeNull()
  })

  it("puts the requested time first, then nearest times, without duplicates", () => {
    expect(orderAvailabilitySlots(["20:00", "19:30", "19:00", "19:00", "18:30"], "19:00")).toEqual([
      "19:00",
      "18:30",
      "19:30",
      "20:00",
    ])
  })

  it("returns the final available slots for compact result cards", () => {
    expect(lastAvailabilitySlots(["19:30", "21:30", "20:00", "21:00", "20:30", "21:30"])).toEqual([
      "20:30",
      "21:00",
      "21:30",
    ])
  })

  it("uses stored coordinates first and can recover coordinates from a real Maps URL", () => {
    expect(getPublicMapCoordinates({ latitude: 41.0083, longitude: 28.9784, locationUrl: null })).toEqual({ latitude: 41.0083, longitude: 28.9784 })
    expect(getPublicMapCoordinates({ latitude: null, longitude: null, locationUrl: "https://maps.google.com/?ll=41.008335,28.973818&z=14" })).toEqual({ latitude: 41.008335, longitude: 28.973818 })
    expect(getPublicMapCoordinates({ latitude: null, longitude: null, locationUrl: "https://www.google.com/maps/place/Midpoint/data=!3d36.8369351!4d28.2624" })).toEqual({ latitude: 36.8369351, longitude: 28.2624 })
    expect(getPublicMapCoordinates({ latitude: null, longitude: null, locationUrl: "<meta content=\"https://maps.google.com/maps/api/staticmap?center=36.8369351%2C28.2624&zoom=14\" property=\"og:image\">" })).toEqual({ latitude: 36.8369351, longitude: 28.2624 })
    expect(getPublicMapCoordinates({ latitude: null, longitude: null, locationUrl: "https://maps.google.com/?q=New+Felix" })).toBeNull()
  })
})
