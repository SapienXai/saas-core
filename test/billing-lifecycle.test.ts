import { describe, expect, it } from "vitest"
import { resolveBillingRetry } from "@sapienx/saas-core"
import { validatePaddleSubscriptionShape } from "../lib/billing/webhook"
import {
  compareBillingEventOrder,
  isBillingEnvironmentMatch,
  projectCanonicalSubscription,
} from "../lib/billing/reconciliation"

const mapping = {
  id: "mapping-1",
  provider: "paddle" as const,
  environment: "sandbox" as const,
  plan_key: "paid",
  provider_product_id: "pro-1",
  provider_price_id: "pri-1",
  billing_interval: "month" as const,
  currency: "USD",
  active: true,
}

const subscription = {
  id: "sub-new",
  status: "active" as const,
  customerId: "ctm-1",
  nextBilledAt: "2026-10-01T00:00:00Z",
  currentBillingPeriod: { startsAt: "2026-09-01T00:00:00Z", endsAt: "2026-10-01T00:00:00Z" },
  scheduledChange: null,
  customData: { saas_core_billing_environment: "sandbox" },
  items: [{ priceId: "pri-1", productId: "pro-1", quantity: 1 }],
}

describe("canonical billing lifecycle", () => {
  it("permits a canceled subscription to be replaced and converges duplicate events", () => {
    const current = {
      provider: "paddle",
      provider_environment: "sandbox",
      provider_subscription_id: "sub-old",
      provider_status: "canceled",
      plan_key: "workspace",
      last_provider_event_at: "2026-09-30T00:00:00Z",
      last_provider_event_id: "evt-old",
    }
    const first = projectCanonicalSubscription({
      eventId: "evt-new",
      occurredAt: "2026-09-01T00:00:00Z",
      subscription,
      mapping,
      fallbackPlanKey: "workspace",
      current,
      now: new Date("2026-09-09T00:00:00Z"),
    })
    expect(first.applied).toBe(true)
    expect(first.planKey).toBe("paid")
    const duplicate = projectCanonicalSubscription({
      eventId: "evt-new",
      occurredAt: "2026-09-01T00:00:00Z",
      subscription,
      mapping,
      fallbackPlanKey: "workspace",
      current: { ...current, provider_subscription_id: "sub-new", provider_status: "active", last_provider_event_at: "2026-09-01T00:00:00Z", last_provider_event_id: "evt-new" },
      now: new Date("2026-09-09T00:00:00Z"),
    })
    expect(duplicate.applied).toBe(false)
    expect(duplicate.reason).toBe("DUPLICATE")
  })

  it("orders equal timestamps deterministically and rejects stale events", () => {
    expect(compareBillingEventOrder("2026-09-01T00:00:00Z", "evt-b", "2026-09-01T00:00:00Z", "evt-a")).toBe("newer")
    expect(compareBillingEventOrder("2026-08-31T00:00:00Z", "evt-z", "2026-09-01T00:00:00Z", "evt-a")).toBe("older")
    expect(resolveBillingRetry({ outcome: "unknown", attempts: 1, maxAttempts: 3 })).toBe("reconcile")
    expect(resolveBillingRetry({ outcome: "unknown", attempts: 3, maxAttempts: 3 })).not.toBe("retry")
    expect(isBillingEnvironmentMatch("sandbox", "sandbox")).toBe(true)
    expect(isBillingEnvironmentMatch("sandbox", "live")).toBe(false)
  })

  it("applies the exact grace boundary and fails closed on unexpected items", () => {
    const pastDue = projectCanonicalSubscription({
      eventId: "evt-grace",
      occurredAt: "2026-09-01T00:00:00Z",
      subscription: { ...subscription, id: "sub-grace", status: "past_due" },
      mapping,
      fallbackPlanKey: "workspace",
      current: { plan_key: "paid" },
      now: new Date("2026-09-15T00:00:00Z"),
    })
    expect(pastDue.planKey).toBe("workspace")
    expect(() => validatePaddleSubscriptionShape({ ...subscription, items: [] })).toThrow(/exactly one recurring item/)
    expect(() => validatePaddleSubscriptionShape({ ...subscription, items: [{ ...subscription.items[0], productId: "other" }] })).not.toThrow()
  })

  it("keeps the current plan when reconciliation observes a mapped future target price", () => {
    const targetMapping = { ...mapping, plan_key: "target", provider_price_id: "pri-target", billing_interval: "year" as const }
    const current = {
      plan_key: "paid",
      billing_interval: "month",
      billing_currency: "USD",
      scheduled_plan_key: "target",
      scheduled_plan_at: "2026-10-01T00:00:00Z",
      scheduled_effective_at: "2026-10-01T00:00:00Z",
      scheduled_plan_interval: "year",
      scheduled_provider_price_id: "pri-target",
    }
    const pending = projectCanonicalSubscription({
      eventId: "evt-target-price",
      occurredAt: "2026-09-15T00:00:00Z",
      subscription: { ...subscription, items: [{ priceId: "pri-target", productId: "pro-1", quantity: 1 }] },
      mapping: targetMapping,
      fallbackPlanKey: "workspace",
      current,
      now: new Date("2026-09-20T00:00:00Z"),
    })
    expect(pending.planKey).toBe("paid")
    expect(pending.billingInterval).toBe("month")
    expect(pending.scheduledPlanKey).toBe("target")

    const boundary = projectCanonicalSubscription({
      eventId: "evt-target-boundary",
      occurredAt: "2026-10-01T00:00:00Z",
      subscription: { ...subscription, items: [{ priceId: "pri-target", productId: "pro-1", quantity: 1 }] },
      mapping: targetMapping,
      fallbackPlanKey: "workspace",
      current,
      now: new Date("2026-10-01T00:00:00Z"),
    })
    expect(boundary.planKey).toBe("target")
    expect(boundary.billingInterval).toBe("year")
    expect(boundary.scheduledPlanKey).toBeNull()
  })

  it("keeps a same-plan annual subscription active until a deferred monthly boundary", () => {
    const monthlyMapping = { ...mapping, provider_price_id: "pri-paid-month", billing_interval: "month" as const }
    const current = {
      plan_key: "paid",
      billing_interval: "year",
      billing_currency: "USD",
      scheduled_plan_key: "paid",
      scheduled_plan_at: "2026-10-01T00:00:00Z",
      scheduled_effective_at: "2026-10-01T00:00:00Z",
      scheduled_plan_interval: "month",
      scheduled_provider_price_id: "pri-paid-month",
    }
    const pending = projectCanonicalSubscription({
      eventId: "evt-interval-pending",
      occurredAt: "2026-09-20T00:00:00Z",
      subscription: { ...subscription, items: [{ priceId: "pri-paid-month", productId: "pro-1", quantity: 1 }] },
      mapping: monthlyMapping,
      fallbackPlanKey: "workspace",
      current,
      now: new Date("2026-09-20T00:00:00Z"),
    })
    expect(pending.planKey).toBe("paid")
    expect(pending.billingInterval).toBe("year")
    expect(pending.scheduledPlanKey).toBe("paid")
    expect(pending.scheduledPlanInterval).toBe("month")

    const boundary = projectCanonicalSubscription({
      eventId: "evt-interval-boundary",
      occurredAt: "2026-10-01T00:00:00Z",
      subscription: { ...subscription, items: [{ priceId: "pri-paid-month", productId: "pro-1", quantity: 1 }] },
      mapping: monthlyMapping,
      fallbackPlanKey: "workspace",
      current,
      now: new Date("2026-10-01T00:00:00Z"),
    })
    expect(boundary.planKey).toBe("paid")
    expect(boundary.billingInterval).toBe("month")
    expect(boundary.scheduledPlanKey).toBeNull()
    expect(boundary.scheduledPlanInterval).toBeNull()
  })
})
