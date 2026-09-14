import { describe, expect, it } from "vitest"
import { evaluatePlanChangeEligibility } from "../packages/core/src/index"

describe("provider-neutral plan-change eligibility", () => {
  it("allows a downgrade below the finite target limit and at the exact boundary", () => {
    expect(evaluatePlanChangeEligibility({
      targetPlanKey: "free",
      checks: [{ capability: "venues", targetLimit: 3, current: 2, usageAvailable: true }],
    })).toEqual({ targetPlanKey: "free", allowed: true, violations: [] })

    expect(evaluatePlanChangeEligibility({
      targetPlanKey: "free",
      checks: [{ capability: "venues", targetLimit: 3, current: 3, usageAvailable: true }],
    })).toEqual({ targetPlanKey: "free", allowed: true, violations: [] })
  })

  it("reports finite quota excess with structured context", () => {
    expect(evaluatePlanChangeEligibility({
      targetPlanKey: "free",
      checks: [{ capability: "venues", targetLimit: 1, current: 4, usageAvailable: true }],
    })).toEqual({
      targetPlanKey: "free",
      allowed: false,
      violations: [{ capability: "venues", reason: "LIMIT_EXCEEDED", current: 4, targetLimit: 1, excess: 3 }],
    })
  })

  it("returns every violation when multiple finite capabilities exceed the target", () => {
    const result = evaluatePlanChangeEligibility({
      targetPlanKey: "free",
      checks: [
        { capability: "venues", targetLimit: 1, current: 4, usageAvailable: true },
        { capability: "core.members", targetLimit: 2, current: 3, usageAvailable: true },
      ],
    })

    expect(result.allowed).toBe(false)
    expect(result.violations).toHaveLength(2)
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: "venues", reason: "LIMIT_EXCEEDED", excess: 3 }),
      expect.objectContaining({ capability: "core.members", reason: "LIMIT_EXCEEDED", excess: 1 }),
    ]))
  })

  it("allows explicit unlimited targets without requiring usage", () => {
    expect(evaluatePlanChangeEligibility({
      targetPlanKey: "business",
      checks: [{ capability: "venues", targetLimit: null, usageAvailable: false }],
    })).toEqual({ targetPlanKey: "business", allowed: true, violations: [] })
  })

  it("fails closed for unavailable usage and missing target capabilities", () => {
    expect(evaluatePlanChangeEligibility({
      targetPlanKey: "free",
      checks: [
        { capability: "venues", targetLimit: 1, usageAvailable: false },
        { capability: "storageBytes", targetLimit: undefined, configured: false },
      ],
    })).toEqual({
      targetPlanKey: "free",
      allowed: false,
      violations: [
        { capability: "venues", reason: "USAGE_UNAVAILABLE", targetLimit: 1 },
        { capability: "storageBytes", reason: "CAPABILITY_NOT_CONFIGURED", targetLimit: undefined },
      ],
    })
  })

  it("rejects an invalid target plan key", () => {
    expect(evaluatePlanChangeEligibility({ targetPlanKey: "", checks: [] })).toEqual({
      targetPlanKey: "",
      allowed: false,
      violations: [{ capability: "plan", reason: "INVALID_PLAN" }],
    })
  })
})
