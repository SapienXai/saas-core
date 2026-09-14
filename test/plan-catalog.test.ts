import { describe, expect, it } from "vitest"
import {
  classifyProductPlanChange,
  duplicateProductPlan,
  hasCommercialPlanChange,
  isProductPlanKey,
  normalizeProductPlan,
  validatePlanDefinition,
} from "@sapienx/saas-core"

const basePlan = {
  key: "team",
  name: "Team",
  description: "Shared workspace access",
  active: true,
  recommended: true,
  sort_order: 10,
  prices: { month: { amount: 12, currency: "USD", providerPriceId: "price_provider_owned" } },
  features: { collaboration: true },
  limits: { seats: 5, storage_bytes: null },
  metadata: { billingLabel: "Team" },
} as const

describe("reusable product plan catalog contract", () => {
  it("accepts consumer-defined keys and preserves the missing versus unlimited distinction", () => {
    expect(isProductPlanKey("music_workspace")).toBe(true)
    expect(isProductPlanKey("reservations")).toBe(true)
    expect(isProductPlanKey("bad key")).toBe(false)

    const plan = validatePlanDefinition({ key: "custom", name: "Custom", limits: { venues: 1, storage_bytes: null } })
    expect(plan.limits).toEqual({ venues: 1, storage_bytes: null })
    expect((plan.limits || {}).missing).toBeUndefined()
    expect(normalizeProductPlan(plan)).toMatchObject({ active: true, sort_order: 0, features: {}, limits: { venues: 1, storage_bytes: null } })
  })

  it("keeps archived definitions valid without making them a new default implicitly", () => {
    const archived = normalizeProductPlan({ ...basePlan, active: false })
    expect(archived.active).toBe(false)
    expect(archived.key).toBe("team")
  })

  it("classifies presentation changes separately from entitlement changes", () => {
    expect(classifyProductPlanChange(basePlan, { ...basePlan, name: "Team workspaces" })).toBe("presentation")
    expect(classifyProductPlanChange(basePlan, { ...basePlan, active: false })).toBe("presentation")
    expect(classifyProductPlanChange(basePlan, { ...basePlan, limits: { seats: 10, storage_bytes: null } })).toBe("commercial")
    expect(hasCommercialPlanChange(basePlan, { ...basePlan, metadata: { billingLabel: "Team", internal: "v2" } })).toBe(true)
    expect(classifyProductPlanChange(basePlan, { ...basePlan, key: "team_v2" })).toBe("identity")
  })

  it("duplicates as inactive and strips provider price references", () => {
    const duplicate = duplicateProductPlan(basePlan, "team_v2", { name: "Team v2" })
    expect(duplicate).toMatchObject({ key: "team_v2", name: "Team v2", active: false })
    expect(duplicate.prices?.month).toEqual({ amount: 12, currency: "USD" })
    expect(duplicate.limits?.storage_bytes).toBeNull()
  })

  it("rejects malformed capability maps and arbitrary unlimited sentinels", () => {
    expect(() => validatePlanDefinition({ key: "bad", name: "Bad", limits: { venues: Infinity } })).toThrow()
    expect(() => validatePlanDefinition({ key: "bad", name: "Bad", limits: { venues: undefined } })).toThrow()
    expect(() => validatePlanDefinition({ key: "bad", name: "Bad", features: { export: "yes" } })).toThrow()
  })
})
