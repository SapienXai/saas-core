import { describe, expect, it } from "vitest"
import { defineProductConfig, type SaaSCoreProductConfig } from "../packages/config/src/index"
import {
  getBillingPlanOrder,
  getBillingProrationMode,
  getPaymentGraceEndsAt,
  isBillingInterval,
  isBillingTransitionAllowed,
  resolveBillingRetry,
  resolveBillingTransition,
  resolveEffectiveBillingPlan,
  validateBillingPolicy,
} from "../packages/core/src/index"

function catalog(overrides: Record<string, unknown> = {}) {
  return {
    defaultPlanKey: "team_plus",
    plans: [
      {
        key: "team_plus",
        name: "Team Plus",
        features: { collaboration: true, exports: false },
        limits: { "core.workspaces": null, seats: 25 },
        prices: { month: { amount: 1200, currency: "USD" } },
      },
      {
        key: "starter_2",
        name: "Starter 2",
        features: { collaboration: false },
        limits: { "core.workspaces": 1, seats: 3 },
      },
    ],
    usageMetrics: [{ key: "projects", name: "Projects", unit: "items" }],
    ...overrides,
  }
}

function productConfig(overrides: Record<string, unknown> = {}): SaaSCoreProductConfig {
  return {
    identity: { name: "Example Product", slug: "example-product" },
    capabilities: { billing: true },
    catalog: catalog(),
    ...overrides,
  } as SaaSCoreProductConfig
}

describe("provider-neutral billing contract", () => {
  it("keeps a single existing catalog valid and allows arbitrary product plan keys", () => {
    const single = productConfig({
      catalog: {
        defaultPlanKey: "custom_default",
        plans: [{ key: "custom_default", name: "Custom Default", features: {}, limits: { "core.workspaces": 1 } }],
      },
    })

    expect(defineProductConfig(single).catalog.defaultPlanKey).toBe("custom_default")
    expect(defineProductConfig(productConfig()).catalog.plans.map((plan) => plan.key)).toEqual(["team_plus", "starter_2"])
  })

  it("validates optional policy, ordered plans, intervals, copy, features, and limits", () => {
    const config = productConfig({
      billing: {
        defaultPlanKey: "team_plus",
        fallbackPlanKey: "starter_2",
        supportedIntervals: ["month", "year"],
        defaultInterval: "year",
        paymentGracePeriodDays: 14,
        initialWorkspaceTrialDays: 14,
        presentation: {
          planOrder: ["starter_2", "team_plus"],
          plans: { team_plus: { description: "For growing teams", highlights: ["Shared work"] } },
          copy: { title: "Choose a plan" },
          featureKeys: ["collaboration"],
          limitKeys: ["seats"],
          comparison: [{ key: "seats", label: "Seats", kind: "limit", limitKey: "seats" }],
        },
      },
    })

    const result = defineProductConfig(config)
    expect(result.billing?.defaultInterval).toBe("year")
    expect(result.billing?.initialWorkspaceTrialDays).toBe(14)
    expect(result.catalog.plans[0]?.limits?.["core.workspaces"]).toBeNull()
    expect(getBillingPlanOrder(result.catalog.plans.map((plan) => plan.key), result.billing?.presentation?.planOrder)).toEqual(["starter_2", "team_plus"])
  })

  it("restricts the configured first Workspace trial duration to a safe range", () => {
    expect(() => validateBillingPolicy({ initialWorkspaceTrialDays: 0 })).toThrow(/initialWorkspaceTrialDays/)
    expect(() => validateBillingPolicy({ initialWorkspaceTrialDays: 91 })).toThrow(/initialWorkspaceTrialDays/)
    expect(validateBillingPolicy({ initialWorkspaceTrialDays: 14 })).toBeUndefined()
  })

  it("rejects malformed catalogs and optional billing fields", () => {
    expect(() => defineProductConfig(productConfig({ catalog: catalog({ defaultPlanKey: "missing" }) }))).toThrow(/existing default plan key/)
    expect(() => defineProductConfig(productConfig({ catalog: catalog({ plans: [{ key: "team_plus", name: "Team Plus", limits: {} }] }) }))).toThrow(/core\.workspaces/)
    expect(() => defineProductConfig(productConfig({ catalog: catalog({ plans: [{ key: "team_plus", name: "Team Plus", limits: { "core.workspaces": 1 }, prices: { week: { amount: 100, currency: "USD" } } }] }) }))).toThrow(/unsupported billing interval/)
    expect(() => defineProductConfig(productConfig({ billing: { supportedIntervals: ["month", "month"] } }))).toThrow(/duplicates/)
    expect(() => defineProductConfig(productConfig({ billing: { defaultInterval: "year", supportedIntervals: ["month"] } }))).toThrow(/listed in supportedIntervals/)
    expect(() => defineProductConfig(productConfig({ billingPresentation: { planOrder: ["team_plus", "team_plus"] } }))).toThrow(/duplicates/)
    expect(() => defineProductConfig(productConfig({ billingPresentation: { featureKeys: ["missing_feature"] } }))).toThrow(/undefined feature key/)
    expect(() => defineProductConfig(productConfig({ billingPresentation: { copy: { title: "" } } }))).toThrow(/non-empty copy/)
  })

  it("distinguishes supported intervals and explicit unlimited limits", () => {
    expect(isBillingInterval("month")).toBe(true)
    expect(isBillingInterval("year")).toBe(true)
    expect(isBillingInterval("week")).toBe(false)
    expect(catalog().plans[0]?.limits?.["core.workspaces"]).toBeNull()
    expect(catalog().plans[1]?.limits?.["core.workspaces"]).toBe(1)
  })

  it("projects lifecycle statuses and transition timing deterministically", () => {
    const graceEndsAt = getPaymentGraceEndsAt("2026-09-01T00:00:00.000Z", 14)
    expect(graceEndsAt).toBe("2026-09-15T00:00:00.000Z")
    expect(resolveEffectiveBillingPlan({ status: "active", purchasedPlanKey: "paid", fallbackPlanKey: "starter_2" })).toBe("paid")
    expect(resolveEffectiveBillingPlan({ status: "paused", purchasedPlanKey: "paid", fallbackPlanKey: "starter_2" })).toBe("starter_2")
    for (const status of ["pending", "expired", "unpaid"]) {
      expect(resolveEffectiveBillingPlan({ status, purchasedPlanKey: "paid", fallbackPlanKey: "starter_2" })).toBe("starter_2")
    }
    expect(resolveEffectiveBillingPlan({ status: "past_due", purchasedPlanKey: "paid", fallbackPlanKey: "starter_2", paymentGraceEndsAt: graceEndsAt!, now: new Date("2026-09-14T23:59:59.999Z") })).toBe("paid")
    expect(resolveEffectiveBillingPlan({ status: "past_due", purchasedPlanKey: "paid", fallbackPlanKey: "starter_2", paymentGraceEndsAt: graceEndsAt!, now: new Date("2026-09-15T00:00:00.000Z") })).toBe("starter_2")
    expect(resolveEffectiveBillingPlan({ status: "provider_unknown", purchasedPlanKey: "paid", fallbackPlanKey: "starter_2" })).toBe("starter_2")

    expect(isBillingTransitionAllowed("active", "past_due")).toBe(true)
    expect(isBillingTransitionAllowed("pending", "active")).toBe(true)
    expect(isBillingTransitionAllowed("active", "unpaid")).toBe(true)
    expect(isBillingTransitionAllowed("unpaid", "active")).toBe(true)
    expect(isBillingTransitionAllowed("expired", "active")).toBe(false)
    expect(isBillingTransitionAllowed("canceled", "past_due")).toBe(false)
    expect(resolveBillingTransition({ from: "active", to: "active", effectiveAt: "2099-01-01T00:00:00.000Z", now: new Date("2026-01-01T00:00:00.000Z") })).toBe("schedule")
    expect(resolveBillingTransition({ from: "active", to: "past_due" })).toBe("apply")
    expect(resolveBillingTransition({ from: "active", to: "canceled", state: "unknown" })).toBe("reconcile")
  })

  it("makes proration, retry, and unknown outcomes explicit", () => {
    expect(getBillingProrationMode("upgrade")).toBe("immediate")
    expect(getBillingProrationMode("downgrade")).toBe("next_period")
    expect(getBillingProrationMode("cancel")).toBe("none")
    expect(resolveBillingRetry({ outcome: "unknown" })).toBe("reconcile")
    expect(resolveBillingRetry({ outcome: "failed", retryable: true, attempts: 1, maxAttempts: 3 })).toBe("retry")
    expect(resolveBillingRetry({ outcome: "failed", retryable: false })).toBe("stop")
    expect(resolveBillingRetry({ outcome: "succeeded" })).toBe("stop")
  })
})
