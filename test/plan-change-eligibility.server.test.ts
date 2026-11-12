import { beforeEach, describe, expect, it, vi } from "vitest"

const { createServiceRoleClient, productResolvers, fallbackPlanKey } = vi.hoisted(() => ({
  createServiceRoleClient: vi.fn(),
  productResolvers: {} as Record<string, (context: unknown) => number | Promise<number>>,
  fallbackPlanKey: vi.fn(async () => "free"),
}))

vi.mock("@/lib/supabase", () => ({ createServiceRoleClient }))
vi.mock("@/src/product/usage", () => ({ getProductUsageResolvers: () => productResolvers }))
vi.mock("@/lib/billing/reconciliation", () => ({
  getConfiguredFallbackPlanKey: fallbackPlanKey,
  isPaymentGraceExpired: () => false,
}))

import { validatePlanChangeEligibility } from "../lib/entitlements"

type QueryResult = { data: unknown; count?: number; error: null | { message: string; code?: string } }

function createService() {
  const plans = [
    { key: "pro", name: "Pro", sort_order: 10, active: true, features: {}, limits: { "core.workspaces": 2, "core.members": 3, venues: 5, "offline.audio_bytes": 1073741824 }, metadata: {} },
    { key: "free", name: "Free", sort_order: 0, active: true, features: {}, limits: { "core.workspaces": 2, "core.members": 3, venues: 1, "offline.audio_bytes": 1073741824 }, metadata: {} },
    { key: "business", name: "Business", sort_order: 20, active: true, features: {}, limits: { "core.workspaces": null, "core.members": null, venues: null, "offline.audio_bytes": 1073741824 }, metadata: {} },
    { key: "offline-small", name: "Offline Small", sort_order: 5, active: true, features: {}, limits: { "core.workspaces": 2, "core.members": 3, venues: 1, "offline.audio_bytes": 536870912 }, metadata: {} },
  ]

  return {
    from: vi.fn((table: string) => {
      const filters = new Map<string, unknown>()
      const result = (): QueryResult => {
        if (table === "workspaces") return { data: { id: "eligibility-workspace", created_by: "owner", status: "active", platform_status: "active" }, error: null }
        if (table === "workspace_subscriptions") return { data: { workspace_id: "eligibility-workspace", plan_key: "pro", status: "active", source: "manual", provider: null, provider_environment: null, provider_customer_id: null, provider_subscription_id: null, provider_price_id: null, current_period_start: null, current_period_end: null, current_period_start_at: null, current_period_end_at: null, cancel_at_period_end: false, scheduled_change_at: null, scheduled_change_action: null, scheduled_plan_key: null, scheduled_plan_at: null, scheduled_effective_at: null, scheduled_provider_price_id: null, payment_failure_started_at: null, payment_grace_ends_at: null, billing_issue_code: null }, error: null }
        if (table === "subscription_overrides") return { data: null, error: null }
        if (table === "workspace_members") return { data: null, count: 2, error: null }
        if (table === "workspace_invitations") return { data: null, count: 1, error: null }
        if (table === "plans" && filters.has("in:key")) return { data: plans.filter((plan) => (filters.get("in:key") as string[]).includes(plan.key)), error: null }
        if (table === "plans") return { data: plans.find((plan) => plan.key === filters.get("key")) || null, error: null }
        if (table === "workspace_usage_periods") return { data: { usage: {} }, error: null }
        return { data: null, error: null }
      }
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn((key: string, value: unknown) => { filters.set(key, value); return builder }),
        in: vi.fn((key: string, value: unknown) => { filters.set(`in:${key}`, value); return builder }),
        is: vi.fn(() => builder),
        gt: vi.fn(() => builder),
        lte: vi.fn(() => builder),
        where: vi.fn(() => builder),
        order: vi.fn(() => builder),
        limit: vi.fn(() => builder),
        maybeSingle: vi.fn(async () => result()),
        then: (onfulfilled: Promise<QueryResult>["then"] extends (onfulfilled?: infer F, onrejected?: infer R) => unknown ? F : never, onrejected?: unknown) => Promise.resolve(result()).then(onfulfilled as never, onrejected as never),
      }
      return builder
    }),
  }
}

describe("server target-plan eligibility", () => {
  beforeEach(() => {
    for (const key of Object.keys(productResolvers)) delete productResolvers[key]
    createServiceRoleClient.mockReturnValue(createService())
  })

  it("uses workspace-scoped Core members including pending invitations", async () => {
    productResolvers.venues = () => 1

    await expect(validatePlanChangeEligibility("eligibility-workspace", "free")).resolves.toEqual({
      targetPlanKey: "free",
      allowed: true,
      violations: [],
    })
  })

  it("reports product usage excess without trusting a client counter", async () => {
    productResolvers.venues = () => 2
    const result = await validatePlanChangeEligibility("eligibility-workspace", "free")

    expect(result.allowed).toBe(false)
    expect(result.violations).toEqual(expect.arrayContaining([
      { capability: "venues", reason: "LIMIT_EXCEEDED", current: 2, targetLimit: 1, excess: 1 },
    ]))
  })

  it("does not require usage for a finite capability whose target limit is unchanged", async () => {
    productResolvers.venues = () => 1

    await expect(validatePlanChangeEligibility("eligibility-workspace", "free")).resolves.toEqual({
      targetPlanKey: "free",
      allowed: true,
      violations: [],
    })
  })

  it("still fails closed when a finite target limit is reduced and its usage is unavailable", async () => {
    productResolvers.venues = () => 1
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined)

    await expect(validatePlanChangeEligibility("eligibility-workspace", "offline-small")).resolves.toMatchObject({
      allowed: false,
      violations: expect.arrayContaining([
        { capability: "offline.audio_bytes", reason: "USAGE_UNAVAILABLE", targetLimit: 536870912 },
      ]),
    })
    error.mockRestore()
  })

  it("does not require product usage for an explicit unlimited target", async () => {
    const resolver = vi.fn(() => { throw new Error("should not be called") })
    productResolvers.venues = resolver

    await expect(validatePlanChangeEligibility("eligibility-workspace", "business")).resolves.toEqual({
      targetPlanKey: "business",
      allowed: true,
      violations: [],
    })
    expect(resolver).not.toHaveBeenCalled()
  })

  it("fails closed when authoritative product usage is unavailable", async () => {
    productResolvers.venues = () => { throw new Error("product database unavailable") }
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined)

    await expect(validatePlanChangeEligibility("eligibility-workspace", "free")).resolves.toMatchObject({
      allowed: false,
      violations: expect.arrayContaining([
        { capability: "venues", reason: "USAGE_UNAVAILABLE", targetLimit: 1 },
      ]),
    })
    error.mockRestore()
  })
})
