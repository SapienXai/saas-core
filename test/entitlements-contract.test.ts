import { describe, expect, it } from "vitest"
import {
  evaluateEntitlementConsumption,
  evaluateFeatureAccess,
  getEntitlementGateState,
  getUsageSnapshot,
  isUnlimitedEntitlementLimit,
  resolveEffectiveConsumptionLimit,
} from "../packages/core/src/index"

describe("provider-neutral entitlement contract", () => {
  it("distinguishes finite, unlimited, unavailable, and over-limit usage", () => {
    expect(getUsageSnapshot(2, 5)).toEqual({ current: 2, limit: 5, remaining: 3, unlimited: false, percentage: 40, overLimit: false })
    expect(getUsageSnapshot(7, 5)).toEqual({ current: 7, limit: 5, remaining: 0, unlimited: false, percentage: 140, overLimit: true })
    expect(getUsageSnapshot(12, null)).toEqual({ current: 12, limit: null, remaining: null, unlimited: true, percentage: null, overLimit: false })
    expect(getUsageSnapshot(2, undefined)).toEqual({ current: 2, limit: undefined, remaining: undefined, unlimited: false, percentage: null, overLimit: false })
    expect(isUnlimitedEntitlementLimit(null)).toBe(true)
    expect(isUnlimitedEntitlementLimit(0)).toBe(false)
  })

  it("allows consumption below a finite quota and rejects the boundary", () => {
    expect(evaluateEntitlementConsumption({ limit: 3, current: 1, amount: 1 })).toMatchObject({ allowed: true, code: null, current: 1, limit: 3, remaining: 2 })
    expect(evaluateEntitlementConsumption({ limit: 3, current: 3, amount: 1 })).toMatchObject({ allowed: false, code: "PLAN_LIMIT_REACHED", current: 3, limit: 3, remaining: 0 })
    expect(evaluateEntitlementConsumption({ limit: 3, current: 2, amount: 1 })).toMatchObject({ allowed: true, code: null })
  })

  it("supports boolean features, unlimited capabilities, and safe unknown behavior", () => {
    expect(evaluateFeatureAccess(true)).toBe(true)
    expect(evaluateFeatureAccess(undefined)).toBe(false)
    expect(evaluateEntitlementConsumption({ feature: true })).toMatchObject({ allowed: true, code: null, unlimited: false, limit: undefined })
    expect(evaluateEntitlementConsumption({ feature: false })).toMatchObject({ allowed: false, code: "FEATURE_NOT_AVAILABLE" })
    expect(evaluateEntitlementConsumption({ limit: null, current: 1000000, amount: 1 })).toMatchObject({ allowed: true, code: null, unlimited: true })
    expect(evaluateEntitlementConsumption({ current: 0, amount: 1 })).toMatchObject({ allowed: false, code: "CAPABILITY_NOT_CONFIGURED" })
    expect(evaluateEntitlementConsumption({ feature: false, limit: null })).toMatchObject({ allowed: false, code: "FEATURE_NOT_AVAILABLE" })
  })

  it("rejects invalid consumption instead of widening access", () => {
    expect(evaluateEntitlementConsumption({ limit: 10, current: 1, amount: 0 })).toMatchObject({ allowed: false, code: "INVALID_ENTITLEMENT_REQUEST" })
    expect(evaluateEntitlementConsumption({ limit: 10, current: 1, amount: -1 })).toMatchObject({ allowed: false, code: "INVALID_ENTITLEMENT_REQUEST" })
    expect(() => getUsageSnapshot(-1, 10)).toThrow(RangeError)
  })

  it("exposes advisory client gate states from the same evaluator", () => {
    expect(getEntitlementGateState({ feature: true })).toBe("allowed")
    expect(getEntitlementGateState({ feature: false })).toBe("hidden")
    expect(getEntitlementGateState({ feature: false }, { unavailableState: "disabled" })).toBe("disabled")
    expect(getEntitlementGateState({ limit: 1, current: 1, amount: 1 })).toBe("limit_reached")
    expect(getEntitlementGateState({ limit: 1, current: 2, amount: 1 })).toBe("over_limit")
    expect(getEntitlementGateState({})).toBe("upgrade_required")
    expect(getEntitlementGateState({ limit: 1, current: 0, amount: 0 })).toBe("disabled")
  })

  it("keeps the current limit until an explicit scheduled downgrade reaches its boundary", () => {
    expect(resolveEffectiveConsumptionLimit({ activeLimit: 3, scheduledLimit: 1, scheduledPlanIsDowngrade: true })).toMatchObject({
      limit: 3,
      activeLimit: 3,
      scheduledLimit: 1,
      constrainedByScheduledPlan: false,
    })
    expect(resolveEffectiveConsumptionLimit({ activeLimit: 10, scheduledLimit: 3, scheduledPlanIsDowngrade: true }).limit).toBe(10)
    expect(resolveEffectiveConsumptionLimit({ activeLimit: null, scheduledLimit: 3, scheduledPlanIsDowngrade: true }).limit).toBeNull()
    expect(resolveEffectiveConsumptionLimit({ activeLimit: 3, scheduledLimit: null, scheduledPlanIsDowngrade: true }).limit).toBe(3)
    expect(resolveEffectiveConsumptionLimit({ activeLimit: null, scheduledLimit: null, scheduledPlanIsDowngrade: true }).limit).toBeNull()
  })

  it("preserves active limits for other schedules and missing downgrade targets", () => {
    expect(resolveEffectiveConsumptionLimit({ activeLimit: 10, scheduledLimit: 1, scheduledPlanIsDowngrade: false }).limit).toBe(10)
    expect(resolveEffectiveConsumptionLimit({ activeLimit: 3, scheduledPlanIsDowngrade: true })).toMatchObject({
      limit: 3,
      activeLimit: 3,
      scheduledLimit: undefined,
      constrainedByScheduledPlan: false,
    })
  })
})
