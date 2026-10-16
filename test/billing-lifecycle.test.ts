import { describe, expect, it } from "vitest"
import { resolveBillingRetry } from "@sapienx/saas-core"
import { normalizeStripeSubscription } from "../lib/billing/providers/stripe"
import {
  getStripeWebhookDrainBatchLimit,
  isExhaustedWebhookLease,
  selectStripeWebhookDrainCandidates,
} from "../lib/billing/lifecycle"
import {
  compareBillingEventOrder,
  isBillingEnvironmentMatch,
  isTerminalBillingSubscription,
  projectCanonicalSubscription,
} from "../lib/billing/reconciliation"
import type Stripe from "stripe"

const mapping = {
  id: "mapping-1",
  provider: "stripe" as const,
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
  it("treats Stripe's expired incomplete Checkout state as terminal for replacement", () => {
    expect(isTerminalBillingSubscription("incomplete_expired")).toBe(true)
    expect(isTerminalBillingSubscription("expired")).toBe(true)
    expect(isTerminalBillingSubscription("active")).toBe(false)
  })

  it("permits a canceled subscription to be replaced and converges duplicate events", () => {
    const current = {
      provider: "stripe",
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

  it("terminalizes an exhausted webhook lease only after it expires", () => {
    const now = new Date("2026-10-08T10:00:00.000Z")
    expect(isExhaustedWebhookLease({ attempts: 5, max_attempts: 5, lease_until: "2026-10-08T09:59:59.000Z" }, now)).toBe(true)
    expect(isExhaustedWebhookLease({ attempts: 4, max_attempts: 5, lease_until: "2026-10-08T09:59:59.000Z" }, now)).toBe(false)
    expect(isExhaustedWebhookLease({ attempts: 5, max_attempts: 5, lease_until: "2026-10-08T10:00:01.000Z" }, now)).toBe(false)
  })

  it("bounds each scheduled webhook drain to a safe batch size", () => {
    expect(getStripeWebhookDrainBatchLimit()).toBe(4)
    expect(getStripeWebhookDrainBatchLimit(1)).toBe(1)
    expect(getStripeWebhookDrainBatchLimit(100)).toBe(4)
    expect(getStripeWebhookDrainBatchLimit(0)).toBe(1)
    expect(getStripeWebhookDrainBatchLimit(Number.NaN)).toBe(4)
  })

  it("selects the oldest retry or expired lease first without exceeding the batch", () => {
    const selected = selectStripeWebhookDrainCandidates(
      [
        { id: "new-retry", attempts: 1, max_attempts: 8, received_at: "2026-10-08T10:03:00.000Z" },
        { id: "exhausted", attempts: 8, max_attempts: 8, received_at: "2026-10-08T10:00:00.000Z" },
      ],
      [
        { id: "old-lease", attempts: 1, max_attempts: 8, received_at: "2026-10-08T10:01:00.000Z" },
        { id: "middle-retry", attempts: 2, max_attempts: 8, received_at: "2026-10-08T10:02:00.000Z" },
      ],
      2,
    )
    expect(selected.map((row) => row.id)).toEqual(["old-lease", "middle-retry"])
  })

  it("allows a freshly fetched authoritative provider snapshot to supersede stale event time", () => {
    const projection = projectCanonicalSubscription({
      eventId: "evt-delayed",
      occurredAt: "2026-09-01T00:00:00Z",
      subscription,
      mapping,
      fallbackPlanKey: "workspace",
      current: {
        provider: "stripe",
        provider_environment: "sandbox",
        provider_subscription_id: "sub-new",
        provider_status: "past_due",
        plan_key: "workspace",
        last_provider_event_at: "2026-10-01T00:00:00Z",
        last_provider_event_id: "evt-later",
      },
      now: new Date("2026-10-02T00:00:00Z"),
      authoritative: true,
    })
    expect(projection.applied).toBe(true)
    expect(projection.planKey).toBe("paid")
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
    expect(() => normalizeStripeSubscription({
      ...subscription,
      id: "sub-invalid",
      livemode: false,
      metadata: {},
      cancel_at: null,
      cancel_at_period_end: false,
      pause_collection: null,
      items: { data: [] },
    } as unknown as Stripe.Subscription)).toThrow(/exactly one registered recurring item/)
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

  it("projects a Stripe schedule as a future target while retaining current paid access", () => {
    const currentMapping = { ...mapping, provider: "stripe" as const, provider_price_id: "price-current", plan_key: "paid" }
    const targetMapping = { ...mapping, provider: "stripe" as const, provider_price_id: "price-target", plan_key: "target", billing_interval: "year" as const }
    const current = {
      provider: "stripe",
      provider_environment: "sandbox",
      provider_subscription_id: "sub-new",
      provider_status: "active",
      plan_key: "paid",
      billing_interval: "month",
      billing_currency: "USD",
    }
    const pending = projectCanonicalSubscription({
      eventId: "evt-schedule-created",
      occurredAt: "2026-09-20T00:00:00Z",
      subscription,
      mapping: currentMapping,
      scheduledPlan: { mapping: targetMapping, effectiveAt: "2026-10-01T00:00:00Z" },
      fallbackPlanKey: "workspace",
      current,
      now: new Date("2026-09-20T00:00:00Z"),
      authoritative: true,
    })
    expect(pending.planKey).toBe("paid")
    expect(pending.billingInterval).toBe("month")
    expect(pending.scheduledPlanKey).toBe("target")
    expect(pending.scheduledPlanInterval).toBe("year")
    expect(pending.scheduledProviderPriceId).toBe("price-target")
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
