import { describe, expect, it } from "vitest"
import {
  getMutationSettlementSteps,
  getProviderMutationSettlement,
  getStripeCheckoutEventStatus,
  isInitialStripeSubscriptionSourceEligible,
  normalizeStripeEvent,
} from "../lib/billing/stripe-webhook"

describe("Stripe initial subscription eligibility", () => {
  it("allows a server-granted trial to convert to its first paid subscription", () => {
    expect(isInitialStripeSubscriptionSourceEligible("trial")).toBe(true)
    expect(isInitialStripeSubscriptionSourceEligible("system")).toBe(true)
    expect(isInitialStripeSubscriptionSourceEligible("provider")).toBe(true)
  })

  it("continues to reject manually assigned commercial states", () => {
    expect(isInitialStripeSubscriptionSourceEligible("manual")).toBe(false)
    expect(isInitialStripeSubscriptionSourceEligible(null)).toBe(false)
    expect(isInitialStripeSubscriptionSourceEligible(undefined)).toBe(false)
  })
})

describe("Stripe webhook normalization", () => {
  it("keeps completed asynchronous Checkout pending until payment is confirmed", () => {
    expect(getStripeCheckoutEventStatus({ status: "complete", paymentStatus: "unpaid" }, "checkout.session.completed"))
      .toBe("created")
    expect(getStripeCheckoutEventStatus({ status: "complete", paymentStatus: "unknown" }, "checkout.session.completed"))
      .toBe("created")
    expect(getStripeCheckoutEventStatus({ status: "complete", paymentStatus: "paid" }, "checkout.session.completed"))
      .toBe("completed")
    expect(getStripeCheckoutEventStatus({ status: "complete", paymentStatus: "no_payment_required" }, "checkout.session.completed"))
      .toBe("completed")
  })

  it("settles asynchronous failure and expiration only from their authoritative state", () => {
    expect(getStripeCheckoutEventStatus({ status: "complete", paymentStatus: "unpaid" }, "checkout.session.async_payment_failed"))
      .toBe("failed")
    expect(getStripeCheckoutEventStatus({ status: "expired", paymentStatus: "unpaid" }, "checkout.session.expired"))
      .toBe("expired")
  })

  it("normalizes signed subscription and invoice events without trusting client state", () => {
    const workspaceId = "9d342cbb-49d6-4614-bd5c-01c266d1511e"
    const subscription = normalizeStripeEvent({
      id: "evt_subscription",
      type: "customer.subscription.updated",
      created: 1_791_400_000,
      livemode: false,
      account: "acct_sandbox",
      data: { object: { id: "sub_sandbox", object: "subscription", metadata: { workspace_id: workspaceId } } },
    })
    expect(subscription).toMatchObject({
      eventId: "evt_subscription",
      eventType: "customer.subscription.updated",
      accountId: "acct_sandbox",
      subscriptionId: "sub_sandbox",
      workspaceId,
      livemode: false,
    })

    const invoice = normalizeStripeEvent({
      id: "evt_invoice",
      type: "invoice.payment_failed",
      created: 1_791_400_001,
      livemode: false,
      data: {
        object: {
          id: "in_sandbox",
          object: "invoice",
          parent: { subscription_details: { subscription: "sub_sandbox", metadata: { workspace_id: workspaceId } } },
        },
      },
    })
    expect(invoice).toMatchObject({ subscriptionId: "sub_sandbox", workspaceId, objectId: "in_sandbox" })
  })

  it("rejects event payloads without verified Stripe event identity", () => {
    expect(() => normalizeStripeEvent({ id: "", type: "invoice.paid", created: 1, livemode: false, data: { object: { id: "in_1", object: "invoice" } } }))
      .toThrow("Stripe webhook event metadata is incomplete or invalid.")
  })
})

describe("Stripe mutation settlement", () => {
  const base = {
    transitionKind: "interval_change",
    toPlanKey: "starter",
    mutationKind: "plan_change",
    providerStatus: "active" as const,
    providerPlanKey: "starter",
    providerBillingInterval: "month",
    expectedPlanKey: "starter",
    expectedBillingInterval: "year",
    hasPendingUpdate: true,
    scheduledPlanKey: null,
    scheduledPlanInterval: null,
    scheduledTargetPlanKey: null,
    scheduledTargetInterval: null,
    cancelAtPeriodEnd: false,
  }

  it("does not confirm an annual interval change while Stripe still has a pending update", () => {
    expect(getProviderMutationSettlement(base)).toBeNull()
    expect(getProviderMutationSettlement({ ...base, pendingUpdateExpired: true })).toEqual({
      state: "failed",
      errorCode: "PROVIDER_CHANGE_NOT_APPLIED",
    })
    expect(getProviderMutationSettlement({ ...base, hasPendingUpdate: false })).toEqual({
      state: "failed",
      errorCode: "PROVIDER_CHANGE_NOT_APPLIED",
    })
  })

  it("confirms a scheduled change only when the active schedule matches its recorded target plan and interval", () => {
    const scheduled = {
      ...base,
      mutationKind: "scheduled_plan_change",
      providerPlanKey: "pro",
      expectedPlanKey: "pro",
      expectedBillingInterval: "month",
      scheduledPlanKey: "starter",
      scheduledPlanInterval: "year",
      scheduledTargetPlanKey: "starter",
      scheduledTargetInterval: "year",
    }
    expect(getProviderMutationSettlement(scheduled)).toEqual({ state: "succeeded", errorCode: null })
    expect(getProviderMutationSettlement({ ...scheduled, scheduledPlanInterval: "month" })).toBeNull()
  })

  it("marks a correlated cancellation as failed when Stripe confirms it was not applied", () => {
    const cancellation = {
      ...base,
      transitionKind: "cancel",
      toPlanKey: "starter",
      mutationKind: "cancel",
      providerBillingInterval: "month",
      expectedPlanKey: "starter",
      expectedBillingInterval: "month",
      hasPendingUpdate: false,
      cancelAtPeriodEnd: false,
    }

    expect(getProviderMutationSettlement(cancellation)).toEqual({
      state: "failed",
      errorCode: "PROVIDER_CHANGE_NOT_APPLIED",
    })
    expect(getProviderMutationSettlement({ ...cancellation, cancelAtPeriodEnd: true })).toEqual({
      state: "succeeded",
      errorCode: null,
    })
    expect(getProviderMutationSettlement({ ...cancellation, providerPlanKey: "business" })).toBeNull()
  })

  it("reconciles provider-confirmed unknown outcomes without directly changing unknown to failed", () => {
    expect(getMutationSettlementSteps("unknown", "succeeded")).toEqual(["succeeded"])
    expect(getMutationSettlementSteps("unknown", "failed")).toEqual(["pending", "failed"])
    expect(getMutationSettlementSteps("succeeded", "failed")).toEqual([])
  })
})
