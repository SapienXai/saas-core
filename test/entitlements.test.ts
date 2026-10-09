import { describe, expect, it, vi } from "vitest"

const { createServiceRoleClient } = vi.hoisted(() => ({ createServiceRoleClient: vi.fn() }))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient }))

import {
  getUsage,
  getWorkspacePlan,
  isScheduledPlanEffective,
  isScheduledPlanPending,
  normalizeFeatures,
  normalizeLimits,
  normalizeUsage,
  resolveProviderPriceTrust,
  resolveEffectiveEntitlementPlan,
  resolveEffectivePlanKey,
} from "../lib/entitlements"
import { getPaymentGraceEndsAt } from "../lib/billing/lifecycle"

const beforeBoundary = new Date("2026-09-15T11:59:59.999Z")
const exactBoundary = new Date("2026-09-15T12:00:00.000Z")
const afterBoundary = new Date("2026-09-15T12:00:00.001Z")

describe("workspace entitlement policy", () => {
  it("keeps missing limits unavailable and only treats JSON null as unlimited", () => {
    expect(normalizeLimits({ unlimited: null, valid: 3, missing: undefined, malformed: "null", negative: -1, boolean: false })).toEqual({ unlimited: null, valid: 3 })
    expect(normalizeFeatures({ enabled: true, disabled: false, malformed: "true", missing: undefined })).toEqual({ enabled: true, disabled: false })
  })

  it("fails closed for malformed scheduled mappings and unknown lifecycle states", () => {
    expect(resolveEffectiveEntitlementPlan({ subscriptionPlanKey: "paid", fallbackPlanKey: "default", status: "provider_unknown" })).toBe("default")
    expect(resolveEffectiveEntitlementPlan({ subscriptionPlanKey: "paid", fallbackPlanKey: "default", scheduledPlanKey: "next", scheduledPlanAt: "not-a-timestamp", now: beforeBoundary })).toBe("default")
    expect(resolveEffectiveEntitlementPlan({ subscriptionPlanKey: null, fallbackPlanKey: "default", status: "active" })).toBe("default")
  })

  it("uses the configured fallback for paused, canceled, and unavailable plans", () => {
    for (const status of ["paused", "canceled", "past_due"] as const) {
      expect(resolveEffectiveEntitlementPlan({ subscriptionPlanKey: "paid", fallbackPlanKey: "default", status, paymentGraceEndsAt: status === "past_due" ? getPaymentGraceEndsAt("2026-09-01T00:00:00.000Z") : null, now: exactBoundary })).toBe("default")
    }
    expect(resolveEffectiveEntitlementPlan({ subscriptionPlanKey: "paid", fallbackPlanKey: "default", status: "past_due", paymentGraceEndsAt: "2026-09-29T00:00:00.000Z", now: exactBoundary })).toBe("paid")
  })

  it("keeps scheduled cancellation active only until its trusted boundary", () => {
    const cancellationAt = "2026-09-20T00:00:00.000Z"
    expect(resolveEffectiveEntitlementPlan({ subscriptionPlanKey: "paid", fallbackPlanKey: "default", status: "active", cancelAtPeriodEnd: true, cancellationEffectiveAt: cancellationAt, now: new Date("2026-09-19T23:59:59.999Z") })).toBe("paid")
    expect(resolveEffectiveEntitlementPlan({ subscriptionPlanKey: "paid", fallbackPlanKey: "default", status: "active", cancelAtPeriodEnd: true, cancellationEffectiveAt: cancellationAt, now: new Date(cancellationAt) })).toBe("default")
    expect(resolveEffectiveEntitlementPlan({ subscriptionPlanKey: "paid", fallbackPlanKey: "default", status: "active", scheduledChangeAction: "cancel", cancellationEffectiveAt: null })).toBe("default")
    expect(resolveEffectiveEntitlementPlan({ subscriptionPlanKey: "paid", fallbackPlanKey: "default", status: "active", scheduledChangeAction: "pause", cancellationEffectiveAt: null })).toBe("default")
  })

  it("does not treat an incomplete non-manual provider projection as paid", () => {
    expect(resolveEffectiveEntitlementPlan({
      subscriptionPlanKey: "paid",
      fallbackPlanKey: "default",
      status: "active",
      source: "provider",
      provider: "stripe",
      providerEnvironment: "sandbox",
      providerCustomerId: "cus_fixture",
      providerSubscriptionId: null,
      providerPriceId: "pri_fixture",
    })).toBe("default")
    expect(resolveEffectiveEntitlementPlan({
      subscriptionPlanKey: "paid",
      fallbackPlanKey: "default",
      status: "active",
      source: "system",
    })).toBe("default")
    expect(resolveEffectiveEntitlementPlan({
      subscriptionPlanKey: "paid",
      fallbackPlanKey: "default",
      status: "active",
      source: "manual",
    })).toBe("paid")
  })

  it("grants an internal trial only before its recorded boundary", () => {
    const trial = {
      subscriptionPlanKey: "pro",
      fallbackPlanKey: "free",
      source: "trial",
      status: "trialing",
      initialTrialEndsAt: "2026-09-15T12:00:00.000Z",
      currentPeriodEndAt: "2026-09-15T12:00:00.000Z",
    } as const

    expect(resolveEffectiveEntitlementPlan({ ...trial, now: beforeBoundary })).toBe("pro")
    expect(resolveEffectiveEntitlementPlan({ ...trial, now: exactBoundary })).toBe("free")
    expect(resolveEffectiveEntitlementPlan({ ...trial, now: beforeBoundary, initialTrialEndsAt: null })).toBe("free")
    expect(resolveEffectiveEntitlementPlan({ ...trial, now: beforeBoundary, status: "active" })).toBe("free")
    expect(resolveEffectiveEntitlementPlan({
      subscriptionPlanKey: "free",
      fallbackPlanKey: "free",
      source: "system",
      status: "active",
      now: beforeBoundary,
    })).toBe("free")
  })

  it("accepts a complete provider-neutral Stripe projection and rejects incomplete or mismatched evidence", () => {
    const stripe = {
      subscriptionPlanKey: "paid",
      fallbackPlanKey: "default",
      status: "active",
      source: "provider",
      provider: "stripe",
      providerEnvironment: "sandbox",
      providerCustomerId: "cus_fixture",
      providerSubscriptionId: "sub_fixture",
      providerPriceId: "price_fixture",
    } as const

    expect(resolveEffectiveEntitlementPlan(stripe)).toBe("paid")
    expect(resolveEffectiveEntitlementPlan({ ...stripe, providerPriceId: null })).toBe("default")
    expect(resolveEffectiveEntitlementPlan({ ...stripe, provider: "Invalid Provider" })).toBe("default")
    expect(resolveEffectiveEntitlementPlan({ ...stripe, provider: "other-provider" })).toBe("paid")
    expect(resolveEffectiveEntitlementPlan({ ...stripe, source: "legacy" })).toBe("default")
  })

  it("accepts only the current or an exact future target provider price", () => {
    const base = {
      source: "provider",
      provider: "stripe",
      providerEnvironment: "sandbox",
      providerCustomerId: "cus_fixture",
      providerSubscriptionId: "sub_fixture",
      subscriptionPlanKey: "pro",
      fallbackPlanKey: "free",
      status: "active",
      providerPriceId: "pri_current",
      scheduledPlanKey: "starter",
      scheduledPlanAt: "2099-01-01T00:00:00.000Z",
      scheduledProviderPriceId: "pri_target",
      scheduledTargetActive: true,
      scheduledTargetProviderPriceMapped: true,
      activeProviderPriceMapped: true,
      now: new Date("2026-09-15T12:00:00.000Z"),
    } as const
    const fixtures = [
      ["current price + future valid downgrade", "current", base],
      ["target price + future valid downgrade", "scheduled-target", { ...base, providerPriceId: "pri_target", activeProviderPriceMapped: false }],
      ["third provider price", null, { ...base, providerPriceId: "pri_third", activeProviderPriceMapped: false }],
      ["missing target mapping", null, { ...base, scheduledTargetProviderPriceMapped: false }],
      ["inactive target", null, { ...base, scheduledTargetActive: false }],
      ["malformed future date", null, { ...base, scheduledPlanAt: "not-a-date" }],
      ["scheduled upgrade", "current", { ...base, scheduledPlanKey: "business" }],
      ["cancellation", "current", { ...base, scheduledPlanKey: null, scheduledPlanAt: null, scheduledProviderPriceId: null, scheduledChangeAction: "cancel" }],
      ["undo", "current", { ...base, scheduledPlanKey: null, scheduledPlanAt: null, scheduledProviderPriceId: null }],
    ] as const

    for (const [label, expected, input] of fixtures) {
      expect(resolveProviderPriceTrust(input), label).toBe(expected)
    }
    expect(resolveEffectiveEntitlementPlan({ ...base, scheduledPlanAt: "2026-09-15T12:00:00.000Z" })).toBe("starter")
  })

  it("falls back when a paid projection has crossed its local billing period", () => {
    expect(resolveEffectiveEntitlementPlan({
      subscriptionPlanKey: "paid",
      fallbackPlanKey: "default",
      status: "active",
      source: "provider",
      provider: "stripe",
      providerEnvironment: "sandbox",
      providerCustomerId: "cus_fixture",
      providerSubscriptionId: "sub_fixture",
      providerPriceId: "pri_fixture",
      currentPeriodEndAt: "2026-09-01T00:00:00.000Z",
      now: new Date("2026-09-12T00:00:00.000Z"),
    })).toBe("default")
  })

  it("gives an active manual override precedence over scheduled and grace state", () => {
    expect(resolveEffectiveEntitlementPlan({ subscriptionPlanKey: "paid", overridePlanKey: "manual", scheduledPlanKey: "next", scheduledPlanAt: "2026-09-01T00:00:00.000Z", fallbackPlanKey: "default", status: "past_due", paymentGraceEndsAt: "2026-09-01T00:00:00.000Z", now: exactBoundary })).toBe("manual")
    expect(resolveEffectivePlanKey("paid", "manual", "next", "2026-09-01T00:00:00.000Z", exactBoundary)).toBe("manual")
  })

  it("applies scheduled plans at the exact instant, including timezone-aware ISO values", () => {
    const effectiveAt = "2026-09-15T15:00:00+03:00"
    expect(resolveEffectivePlanKey("paid", null, "next", effectiveAt, beforeBoundary)).toBe("paid")
    expect(resolveEffectivePlanKey("paid", null, "next", effectiveAt, exactBoundary)).toBe("next")
    expect(resolveEffectivePlanKey("paid", null, "next", effectiveAt, afterBoundary)).toBe("next")
    expect(isScheduledPlanPending(effectiveAt, beforeBoundary)).toBe(true)
    expect(isScheduledPlanEffective(effectiveAt, exactBoundary)).toBe(true)
    expect(isScheduledPlanPending(effectiveAt, exactBoundary)).toBe(false)
  })

  it("keeps date-only schedules through their effective date and hides them after it", () => {
    expect(resolveEffectivePlanKey("paid", null, "next", "2026-09-15", "2026-09-14")).toBe("paid")
    expect(resolveEffectivePlanKey("paid", null, "next", "2026-09-15", "2026-09-15")).toBe("next")
    expect(isScheduledPlanPending("2026-09-15", new Date("2026-09-16T00:00:00.000Z"))).toBe(false)
  })

  it("uses the exact 14-day past-due grace boundary", () => {
    const graceEndsAt = getPaymentGraceEndsAt("2026-09-01T00:00:00.000Z")
    expect(graceEndsAt).toBe("2026-09-15T00:00:00.000Z")
    expect(resolveEffectiveEntitlementPlan({ subscriptionPlanKey: "paid", fallbackPlanKey: "default", status: "past_due", paymentGraceEndsAt: graceEndsAt, now: new Date("2026-09-14T23:59:59.999Z") })).toBe("paid")
    expect(resolveEffectiveEntitlementPlan({ subscriptionPlanKey: "paid", fallbackPlanKey: "default", status: "past_due", paymentGraceEndsAt: graceEndsAt, now: new Date("2026-09-15T00:00:00.000Z") })).toBe("default")
    expect(resolveEffectiveEntitlementPlan({ subscriptionPlanKey: "paid", fallbackPlanKey: "default", status: "past_due", paymentGraceEndsAt: graceEndsAt, now: new Date("2026-09-15T00:00:00.001Z") })).toBe("default")
    expect(getPaymentGraceEndsAt("invalid", -1)).toBeNull()
  })

  it("clears a scheduled response when grace expires at the boundary", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-15T00:00:00.000Z"))
    const query = (table: string, fields = "") => {
      const builder: Record<string, any> = { fields }
      builder.select = (nextFields: string) => { builder.fields = nextFields; return builder }
      builder.eq = () => builder
      builder.gt = () => builder
      builder.lte = () => builder
      builder.in = () => builder
      builder.is = () => builder
      builder.or = () => builder
      builder.order = () => builder
      builder.limit = () => builder
      builder.maybeSingle = async () => {
        if (table === "workspaces") return { data: { id: "grace-workspace", status: "active", platform_status: "active" }, error: null }
        if (table === "workspace_subscriptions") return { data: { workspace_id: "grace-workspace", plan_key: "paid", status: "past_due", source: "provider", scheduled_plan_key: "next", scheduled_effective_at: "2026-09-20T00:00:00.000Z", payment_grace_ends_at: "2026-09-15T00:00:00.000Z" }, error: null }
        if (table === "subscription_overrides") return { data: null, error: null }
        if (table === "plans" && builder.fields === "key") return { data: { key: "default" }, error: null }
        return { data: null, error: null }
      }
      builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [
        { key: "paid", name: "Paid", sort_order: 10, features: { paidFeature: true }, limits: { seats: 20 }, metadata: {} },
        { key: "next", name: "Next", sort_order: 20, features: { nextFeature: true }, limits: { seats: 5 }, metadata: {} },
        { key: "default", name: "Default", sort_order: 0, features: {}, limits: { seats: null }, metadata: {} },
      ], error: null }).then(resolve)
      return builder
    }
    createServiceRoleClient.mockReturnValue({
      rpc: vi.fn(async () => ({ data: { core_default_plan_key: "default" }, error: null })),
      from: vi.fn((table: string) => query(table)),
    })
    try {
      const result = await getWorkspacePlan("grace-workspace")
      expect(result.planKey).toBe("default")
      expect(result.scheduledPlan).toBeNull()
      expect(result.subscription.scheduledPlanKey).toBeNull()
      expect(result.subscription.scheduledPlanAt).toBeNull()
      expect(result.subscription.billingIssueCode).toBe("grace_expired")
    } finally {
      vi.useRealTimers()
    }
  })

  it("preserves arbitrary product usage counters while retaining Core metrics", () => {
    expect(normalizeUsage({ "product.projects": 12, "venue.devices": 4, malformed: "12", negative: -1 })).toEqual({ "product.projects": 12, "venue.devices": 4 })
  })

  it("fails closed for unknown workspaces and non-members", async () => {
    const query = (result: unknown) => {
      const builder: Record<string, unknown> = {}
      builder.select = () => builder
      builder.eq = () => builder
      builder.maybeSingle = async () => result
      return builder
    }

    createServiceRoleClient.mockReturnValue({ from: vi.fn((table: string) => table === "workspaces" ? query({ data: null, error: null }) : query({ data: null, error: null })) })
    await expect(getUsage("missing-workspace", "product.projects")).rejects.toMatchObject({ code: "PLAN_UNAVAILABLE" })

    createServiceRoleClient.mockReturnValue({ from: vi.fn((table: string) => table === "workspaces" ? query({ data: { id: "workspace-non-member", status: "active", platform_status: "active" }, error: null }) : query({ data: null, error: null })) })
    await expect(getUsage("workspace-non-member", "product.projects", "user-without-membership")).rejects.toMatchObject({ code: "PLAN_UNAVAILABLE" })
  })
})
