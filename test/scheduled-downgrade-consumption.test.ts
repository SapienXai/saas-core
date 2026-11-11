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

import {
  assertEntitlement,
  canConsume,
  getEffectiveConsumptionLimit,
  getWorkspaceEntitlements,
} from "../lib/entitlements"

type QueryResult = { data: unknown; count?: number; error: null | { message: string; code?: string } }

type FixtureOptions = {
  workspaceId: string
  subscription: Record<string, unknown>
  usage?: number
  members?: number
  pendingInvitations?: number
  targetLimits?: Record<string, number | null>
  providerMappings?: Array<{ plan_key: string; provider_price_id: string; active?: boolean }>
}

function createService({ workspaceId, subscription, usage = 0, members = 0, pendingInvitations = 0, targetLimits, providerMappings = [] }: FixtureOptions) {
  const plans = [
    { key: "free", name: "Free", sort_order: 0, active: true, features: {}, limits: { venues: 1, "core.members": 2 }, metadata: {} },
    { key: "starter", name: "Starter", sort_order: 5, active: true, features: {}, limits: targetLimits || { venues: 1, "core.members": 2 }, metadata: {} },
    { key: "pro", name: "Pro", sort_order: 10, active: true, features: { venues: true }, limits: { venues: 3, "core.members": 10 }, metadata: {} },
    { key: "business", name: "Business", sort_order: 20, active: true, features: {}, limits: { venues: null, "core.members": null }, metadata: {} },
  ]

  return {
    from: vi.fn((table: string) => {
      const filters = new Map<string, unknown>()
      const result = (): QueryResult => {
        if (table === "workspaces") return { data: { id: workspaceId, created_by: "owner", status: "active", platform_status: "active" }, error: null }
        if (table === "workspace_subscriptions") return { data: { workspace_id: workspaceId, ...subscription }, error: null }
        if (table === "subscription_overrides") return { data: null, error: null }
        if (table === "workspace_members") return { data: null, count: members, error: null }
        if (table === "workspace_invitations") return { data: null, count: pendingInvitations, error: null }
        if (table === "workspace_usage_periods") return { data: { usage: { venues: usage } }, error: null }
        if (table === "billing_provider_prices") {
          const match = providerMappings.find((mapping) => mapping.plan_key === filters.get("plan_key") && mapping.provider_price_id === filters.get("provider_price_id") && mapping.active !== false)
          return { data: match ? { provider_price_id: match.provider_price_id } : null, error: null }
        }
        if (table === "plans" && filters.has("in:key")) return { data: plans.filter((plan) => (filters.get("in:key") as string[]).includes(plan.key)), error: null }
        if (table === "plans") return { data: plans.find((plan) => plan.key === filters.get("key")) || null, error: null }
        return { data: null, error: null }
      }
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn((key: string, value: unknown) => { filters.set(key, value); return builder }),
        in: vi.fn((key: string, value: unknown) => { filters.set(`in:${key}`, value); return builder }),
        is: vi.fn(() => builder),
        gt: vi.fn(() => builder),
        lte: vi.fn(() => builder),
        or: vi.fn(() => builder),
        order: vi.fn(() => builder),
        limit: vi.fn(() => builder),
        maybeSingle: vi.fn(async () => result()),
        then: (onfulfilled: Promise<QueryResult>["then"] extends (onfulfilled?: infer F, onrejected?: infer R) => unknown ? F : never, onrejected?: unknown) => Promise.resolve(result()).then(onfulfilled as never, onrejected as never),
      }
      return builder
    }),
  }
}

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    plan_key: "pro",
    status: "active",
    source: "manual",
    provider: null,
    provider_environment: null,
    provider_customer_id: null,
    provider_subscription_id: null,
    provider_price_id: null,
    current_period_start: null,
    current_period_end: null,
    current_period_start_at: null,
    current_period_end_at: null,
    cancel_at_period_end: false,
    scheduled_change_at: null,
    scheduled_change_action: null,
    scheduled_plan_key: null,
    scheduled_plan_at: null,
    scheduled_effective_at: null,
    scheduled_provider_price_id: null,
    payment_failure_started_at: null,
    payment_grace_ends_at: null,
    billing_issue_code: null,
    ...overrides,
  }
}

function installFixture(options: FixtureOptions) {
  createServiceRoleClient.mockReturnValue(createService(options))
  return { now: new Date("2026-09-14T12:00:00.000Z") }
}

describe("scheduled downgrade consumption ceiling", () => {
  beforeEach(() => {
    for (const key of Object.keys(productResolvers)) delete productResolvers[key]
  })

  it("keeps the active plan's limits until the scheduled downgrade boundary", async () => {
    const workspaceId = "scheduled-downgrade-display-workspace"
    const { now } = installFixture({
      workspaceId,
      subscription: subscription({ scheduled_plan_key: "starter", scheduled_effective_at: "2099-01-01T00:00:00.000Z" }),
      usage: 1,
    })
    productResolvers.venues = () => 1

    const entitlements = await getWorkspaceEntitlements(workspaceId)
    expect(entitlements.planKey).toBe("pro")
    expect(entitlements.scheduledPlan?.key).toBe("starter")

    await expect(getEffectiveConsumptionLimit(workspaceId, "venues", { now })).resolves.toMatchObject({
      limit: 3,
      activeLimit: 3,
      scheduledLimit: 1,
      constrainedByScheduledPlan: false,
      scheduledPlanKey: "starter",
    })
    await expect(canConsume(workspaceId, "venues", 1, { now })).resolves.toMatchObject({
      allowed: true,
      code: null,
      current: 1,
      limit: 3,
      activeLimit: 3,
      scheduledLimit: 1,
      constrainedByScheduledPlan: false,
      scheduledPlanKey: "starter",
    })
    await expect(assertEntitlement(workspaceId, "venues", { now })).resolves.toMatchObject({
      allowed: true,
      limit: 3,
      activeLimit: 3,
      scheduledLimit: 1,
      constrainedByScheduledPlan: false,
      scheduledPlanKey: "starter",
    })
  })

  it("accepts a mapped future target price while keeping the current paid plan authoritative", async () => {
    const workspaceId = "scheduled-downgrade-target-price-workspace"
    installFixture({
      workspaceId,
      subscription: subscription({
        source: "provider",
        provider: "stripe",
        provider_environment: "sandbox",
        provider_customer_id: "cus_fixture",
        provider_subscription_id: "sub_fixture",
        provider_price_id: "pri_starter",
        current_period_end_at: "2099-02-01T00:00:00.000Z",
        scheduled_plan_key: "starter",
        scheduled_plan_at: "2099-01-01T00:00:00.000Z",
        scheduled_effective_at: "2099-01-01T00:00:00.000Z",
        scheduled_provider_price_id: "pri_starter",
      }),
      providerMappings: [
        { plan_key: "pro", provider_price_id: "pri_pro" },
        { plan_key: "starter", provider_price_id: "pri_starter" },
      ],
    })

    const entitlements = await getWorkspaceEntitlements(workspaceId)
    expect(entitlements.planKey).toBe("pro")
    expect(entitlements.features.venues).toBe(true)
    expect(entitlements.scheduledPlan?.key).toBe("starter")
    expect(entitlements.subscription.billingIssueCode).toBeNull()
  })

  it("resolves the mapped target plan after the scheduled boundary", async () => {
    const workspaceId = "scheduled-downgrade-boundary-workspace"
    installFixture({
      workspaceId,
      subscription: subscription({
        source: "provider",
        provider: "stripe",
        provider_environment: "sandbox",
        provider_customer_id: "cus_fixture_boundary",
        provider_subscription_id: "sub_fixture_boundary",
        current_period_end_at: "2099-02-01T00:00:00.000Z",
        provider_price_id: "pri_starter",
        scheduled_plan_key: "starter",
        scheduled_plan_at: "2020-01-01T00:00:00.000Z",
        scheduled_effective_at: "2020-01-01T00:00:00.000Z",
        scheduled_provider_price_id: "pri_starter",
      }),
      providerMappings: [
        { plan_key: "starter", provider_price_id: "pri_starter" },
      ],
    })

    const entitlements = await getWorkspaceEntitlements(workspaceId)
    expect(entitlements.planKey).toBe("starter")
    expect(entitlements.subscription.billingIssueCode).toBeNull()
    expect(entitlements.scheduledPlan).toBeNull()
  })

  it("fails closed when a pending scheduled target cannot be resolved", async () => {
    const workspaceId = "scheduled-downgrade-invalid-target-workspace"
    const { now } = installFixture({
      workspaceId,
      subscription: subscription({ plan_key: "pro", scheduled_plan_key: "missing-target", scheduled_effective_at: "2099-01-01T00:00:00.000Z" }),
      usage: 0,
    })
    productResolvers.venues = () => 0

    await expect(getEffectiveConsumptionLimit(workspaceId, "venues", { now })).resolves.toMatchObject({
      limit: 3,
      activeLimit: 3,
      scheduledLimit: undefined,
      constrainedByScheduledPlan: false,
      scheduledPlanKey: "missing-target",
    })
    await expect(canConsume(workspaceId, "venues", 1, { now })).resolves.toMatchObject({
      allowed: true,
      code: null,
      limit: 3,
      activeLimit: 3,
      scheduledLimit: undefined,
      constrainedByScheduledPlan: false,
      scheduledPlanKey: "missing-target",
    })
  })

  it("applies the target plan at the exact scheduled boundary", async () => {
    const belowId = "scheduled-downgrade-below-workspace"
    const { now } = installFixture({
      workspaceId: belowId,
      subscription: subscription({ scheduled_plan_key: "starter", scheduled_effective_at: "2020-01-01T00:00:00.000Z" }),
      usage: 1,
    })
    productResolvers.venues = () => 1
    await expect(getWorkspaceEntitlements(belowId)).resolves.toMatchObject({ planKey: "starter" })
    await expect(canConsume(belowId, "venues", 1, { now })).resolves.toMatchObject({
      allowed: false,
      code: "PLAN_LIMIT_REACHED",
      limit: 1,
      activeLimit: 1,
      constrainedByScheduledPlan: false,
    })
  })

  it("keeps current limits for cancellation and scheduled upgrades", async () => {
    const cancellationId = "scheduled-cancellation-workspace"
    const { now } = installFixture({
      workspaceId: cancellationId,
      subscription: subscription({ cancel_at_period_end: true, scheduled_change_action: "cancel", scheduled_change_at: "2099-01-01T00:00:00.000Z" }),
      usage: 2,
    })
    productResolvers.venues = () => 2
    await expect(canConsume(cancellationId, "venues", 1, { now })).resolves.toMatchObject({ allowed: true, limit: 3, constrainedByScheduledPlan: false })

    const upgradeId = "scheduled-upgrade-workspace"
    installFixture({
      workspaceId: upgradeId,
      subscription: subscription({ plan_key: "starter", scheduled_plan_key: "pro", scheduled_effective_at: "2099-01-01T00:00:00.000Z" }),
      usage: 1,
    })
    productResolvers.venues = () => 1
    await expect(canConsume(upgradeId, "venues", 1, { now })).resolves.toMatchObject({ allowed: false, limit: 1, constrainedByScheduledPlan: false })
  })

  it("does not impose a downgrade ceiling for a Pro annual-to-monthly interval schedule", async () => {
    const workspaceId = "scheduled-pro-interval-workspace"
    const { now } = installFixture({
      workspaceId,
      subscription: subscription({
        source: "provider",
        provider: "stripe",
        provider_environment: "sandbox",
        provider_customer_id: "cus_interval",
        provider_subscription_id: "sub_interval",
        current_period_end_at: "2099-01-01T00:00:00.000Z",
        provider_price_id: "pri_pro_year",
        billing_interval: "year",
        scheduled_plan_key: "pro",
        scheduled_plan_at: "2099-01-01T00:00:00.000Z",
        scheduled_effective_at: "2099-01-01T00:00:00.000Z",
        scheduled_plan_interval: "month",
        scheduled_provider_price_id: "pri_pro_month",
      }),
      providerMappings: [
        { plan_key: "pro", provider_price_id: "pri_pro_year" },
        { plan_key: "pro", provider_price_id: "pri_pro_month" },
      ],
      usage: 2,
    })
    productResolvers.venues = () => 2

    const entitlements = await getWorkspaceEntitlements(workspaceId)
    expect(entitlements.planKey).toBe("pro")
    expect(entitlements.scheduledPlan?.key).toBe("pro")
    await expect(getEffectiveConsumptionLimit(workspaceId, "venues", { now })).resolves.toMatchObject({
      limit: 3,
      activeLimit: 3,
      constrainedByScheduledPlan: false,
      scheduledPlanKey: null,
    })
    await expect(canConsume(workspaceId, "venues", 1, { now })).resolves.toMatchObject({ allowed: true, limit: 3, constrainedByScheduledPlan: false })

    const boundaryId = "scheduled-pro-interval-boundary-workspace"
    installFixture({
      workspaceId: boundaryId,
      subscription: subscription({
        source: "provider",
        provider: "stripe",
        provider_environment: "sandbox",
        provider_customer_id: "cus_interval_boundary",
        provider_subscription_id: "sub_interval_boundary",
        current_period_end_at: "2099-02-01T00:00:00.000Z",
        provider_price_id: "pri_pro_month",
        billing_interval: "month",
        scheduled_plan_key: "pro",
        scheduled_plan_at: "2020-01-01T00:00:00.000Z",
        scheduled_effective_at: "2020-01-01T00:00:00.000Z",
        scheduled_plan_interval: "month",
        scheduled_provider_price_id: "pri_pro_month",
      }),
      providerMappings: [{ plan_key: "pro", provider_price_id: "pri_pro_month" }],
    })
    const boundary = await getWorkspaceEntitlements(boundaryId)
    expect(boundary.planKey).toBe("pro")
    expect(boundary.scheduledPlan).toBeNull()
    expect(boundary.subscription.billingIssueCode).toBeNull()
  })

  it("removes the transition context after an undo and preserves current limits for an invalid target", async () => {
    const undoId = "scheduled-downgrade-undo-workspace"
    const { now } = installFixture({ workspaceId: undoId, subscription: subscription(), usage: 2 })
    productResolvers.venues = () => 2
    await expect(getEffectiveConsumptionLimit(undoId, "venues", { now })).resolves.toMatchObject({ limit: 3, constrainedByScheduledPlan: false, scheduledPlanKey: null })
    await expect(canConsume(undoId, "venues", 1, { now })).resolves.toMatchObject({ allowed: true, limit: 3 })

    const missingId = "scheduled-downgrade-missing-capability-workspace"
    installFixture({
      workspaceId: missingId,
      subscription: subscription({ scheduled_plan_key: "starter", scheduled_effective_at: "2099-01-01T00:00:00.000Z" }),
      usage: 0,
      targetLimits: { "core.members": 2 },
    })
    await expect(getEffectiveConsumptionLimit(missingId, "venues", { now })).resolves.toMatchObject({
      limit: 3,
      activeLimit: 3,
      scheduledLimit: undefined,
      constrainedByScheduledPlan: false,
    })
    await expect(canConsume(missingId, "venues", 1, { now })).resolves.toMatchObject({ allowed: true, limit: 3, code: null })
  })

  it("keeps Core member limits at the active plan until the scheduled boundary", async () => {
    const workspaceId = "scheduled-downgrade-members-workspace"
    const { now } = installFixture({
      workspaceId,
      subscription: subscription({ scheduled_plan_key: "starter", scheduled_effective_at: "2099-01-01T00:00:00.000Z" }),
      members: 2,
      pendingInvitations: 1,
    })
    await expect(canConsume(workspaceId, "core.members", 1, { now })).resolves.toMatchObject({
      allowed: true,
      code: null,
      current: 3,
      limit: 10,
      activeLimit: 10,
      scheduledLimit: 2,
      constrainedByScheduledPlan: false,
    })
  })
})
