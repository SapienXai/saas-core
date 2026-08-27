import { describe, expect, it } from "vitest"
import { getCalendarPeriod, isReservationVisibleInHistory, resolveEffectivePlanKey, restaurantCreationReason, usageWarningPercent } from "../lib/entitlements"

describe("entitlement boundary helpers", () => {
  it("keeps future reservations visible while applying a history cutoff", () => {
    expect(isReservationVisibleInHistory("2026-07-31", "2026-07-11", "2026-08-09")).toBe(true)
    expect(isReservationVisibleInHistory("2026-06-10", "2026-07-11", "2026-08-09")).toBe(false)
    expect(isReservationVisibleInHistory("2026-08-10", "2026-07-11", "2026-08-09")).toBe(true)
    expect(isReservationVisibleInHistory("2026-01-01", null, "2026-08-09")).toBe(true)
  })

  it("reports restrained usage warning thresholds", () => {
    expect(usageWarningPercent(79, 100)).toBe(79)
    expect(usageWarningPercent(80, 100)).toBe(80)
    expect(usageWarningPercent(100, 100)).toBe(100)
    expect(usageWarningPercent(1000, null)).toBeNull()
  })

  it("uses UTC calendar months for reservation usage buckets", () => {
    expect(getCalendarPeriod(new Date("2026-08-31T23:59:59Z"))).toEqual({ start: "2026-08-01", end: "2026-09-01" })
    expect(getCalendarPeriod(new Date("2026-09-01T00:00:00Z"))).toEqual({ start: "2026-09-01", end: "2026-10-01" })
  })

  it("gives an active manual override precedence over the subscription plan", () => {
    expect(resolveEffectivePlanKey("free", "pro")).toBe("pro")
    expect(resolveEffectivePlanKey("business", null)).toBe("business")
    expect(resolveEffectivePlanKey("starter", undefined)).toBe("starter")
  })

  it("keeps a scheduled downgrade active until its effective date", () => {
    expect(resolveEffectivePlanKey("pro", null, "starter", "2026-08-31", "2026-08-12")).toBe("pro")
    expect(resolveEffectivePlanKey("pro", null, "starter", "2026-08-31", "2026-08-31")).toBe("starter")
    expect(resolveEffectivePlanKey("pro", "business", "starter", "2026-08-01", "2026-08-12")).toBe("business")
  })

  it("uses the numeric restaurant entitlement as the creation capacity source of truth", () => {
    expect(restaurantCreationReason(2, 10)).toBeNull()
    expect(restaurantCreationReason(10, 10)).toBe("restaurant_limit")
    expect(restaurantCreationReason(100, null)).toBeNull()
  })
})
