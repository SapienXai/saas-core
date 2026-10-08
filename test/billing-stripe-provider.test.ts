import { afterEach, describe, expect, it, vi } from "vitest"
import { createHmac } from "node:crypto"
import { assertBillingMutationsEnabled, assertStripeBillingReady, getStripeBillingConfig, isStripeBillingConfigured } from "../lib/billing/config"
import { BillingConfigurationError } from "../lib/billing/config"
import {
  buildStripeCheckoutSessionParams,
  buildStripeScheduleCreateParams,
  buildStripeSchedulePhaseDuration,
  createStripeBillingAdapter,
  getStripeIntegrationIdentifier,
  getStripeMutationIdempotencyKey,
  normalizeStripeSubscription,
} from "../lib/billing/providers/stripe"
import type { ProviderCheckoutRequest } from "../lib/billing/provider"
import type Stripe from "stripe"

afterEach(() => vi.unstubAllEnvs())

function configureStripeSandbox() {
  vi.stubEnv("SAAS_CORE_BILLING_MODE", "")
  vi.stubEnv("STRIPE_ENVIRONMENT", "sandbox")
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_placeholder")
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_placeholder")
  vi.stubEnv("STRIPE_ACCOUNT_ID", "acct_1Tvn6tDKdVwvpd8n")
  vi.stubEnv("STRIPE_BILLING_PORTAL_CONFIGURATION_ID", "bpc_testunit")
}

const checkoutRequest: ProviderCheckoutRequest = {
  mutationId: "2aa3e6f7-0dd2-4a4d-82b1-31bdeefff11a",
  workspaceId: "workspace-example",
  planKey: "starter",
  interval: "month",
  priceId: "price_test_starter_month",
  customerEmail: "owner@example.com",
  successUrl: "https://placedj.example/manage/plan?checkout=success",
  cancelUrl: "https://placedj.example/manage/plan?checkout=cancelled",
}

describe("Stripe billing provider boundary", () => {
  it("accepts matching Sandbox credentials and rejects mode mismatches", () => {
    configureStripeSandbox()
    expect(getStripeBillingConfig()).toMatchObject({ environment: "sandbox", expectedAccountId: "acct_1Tvn6tDKdVwvpd8n" })
    expect(isStripeBillingConfigured()).toBe(true)

    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_placeholder")
    expect(() => getStripeBillingConfig()).toThrow("STRIPE_SECRET_KEY does not match STRIPE_ENVIRONMENT.")
    expect(isStripeBillingConfigured()).toBe(false)
  })

  it("keeps billing unavailable until a Portal configuration is registered", async () => {
    configureStripeSandbox()
    vi.stubEnv("STRIPE_BILLING_PORTAL_CONFIGURATION_ID", "")
    expect(isStripeBillingConfigured()).toBe(false)
    expect(() => assertStripeBillingReady()).toThrow("STRIPE_BILLING_PORTAL_CONFIGURATION_ID is not configured.")
    await expect(createStripeBillingAdapter().createPortalSession({ customerId: "cus_test", returnUrl: "https://placedj.example/manage/plan" }))
      .rejects.toThrow("STRIPE_BILLING_PORTAL_CONFIGURATION_ID is not configured.")
  })

  it("builds a hosted subscription Checkout using flexible billing and dynamic payment methods", () => {
    const params = buildStripeCheckoutSessionParams(checkoutRequest, "sandbox")
    expect(params).toMatchObject({
      mode: "subscription",
      line_items: [{ price: checkoutRequest.priceId, quantity: 1 }],
      client_reference_id: checkoutRequest.workspaceId,
      integration_identifier: expect.stringMatching(/^[a-z]{8}$/),
      metadata: {
        workspace_id: checkoutRequest.workspaceId,
        billing_mutation_id: checkoutRequest.mutationId,
        plan_key: checkoutRequest.planKey,
        billing_interval: checkoutRequest.interval,
      },
      subscription_data: {
        billing_mode: { type: "flexible" },
      },
    })
    expect(params).not.toHaveProperty("payment_method_types")
    expect(params).not.toHaveProperty("customer")
    expect(params.customer_email).toBe(checkoutRequest.customerEmail)
  })

  it("creates schedules from an existing subscription without unsupported metadata", () => {
    expect(buildStripeScheduleCreateParams("sub_test"))
      .toEqual({ from_subscription: "sub_test" })
  })

  it("uses the supported duration shape for a scheduled billing phase", () => {
    expect(buildStripeSchedulePhaseDuration("month", 1))
      .toEqual({ interval: "month", interval_count: 1 })
    expect(() => buildStripeSchedulePhaseDuration("year", 0))
      .toThrow("A schedule phase requires a positive interval count.")
  })

  it("disables Managed Payments only for Sandbox Checkout pending Product tax classification", () => {
    const sandbox = buildStripeCheckoutSessionParams(checkoutRequest, "sandbox")
    const live = buildStripeCheckoutSessionParams(checkoutRequest, "live")
    expect(sandbox.managed_payments).toEqual({ enabled: false })
    expect(live).not.toHaveProperty("managed_payments")
  })

  it("uses a stable Stripe integration identifier for retries of one mutation", () => {
    const first = getStripeIntegrationIdentifier(checkoutRequest.mutationId)
    expect(first).toMatch(/^[a-z]{8}$/)
    expect(getStripeIntegrationIdentifier(checkoutRequest.mutationId)).toBe(first)
    expect(getStripeIntegrationIdentifier("a-different-mutation")).not.toBe(first)
  })

  it("uses distinct stable idempotency keys for subscription updates and schedule release", () => {
    const marker = getStripeMutationIdempotencyKey(checkoutRequest.mutationId, "mutation_marker")
    const release = getStripeMutationIdempotencyKey(checkoutRequest.mutationId, "schedule_release")
    const cancellation = getStripeMutationIdempotencyKey(checkoutRequest.mutationId, "schedule_cancellation")

    expect(new Set([marker, release, cancellation]).size).toBe(3)
    expect(getStripeMutationIdempotencyKey(checkoutRequest.mutationId, "schedule_release")).toBe(release)
    expect(release).toMatch(new RegExp(`^${checkoutRequest.mutationId}_schedule_release$`))
  })

  it("maps every Stripe subscription lifecycle state to a fail-closed core status", () => {
    const normalize = (status: string) => normalizeStripeSubscription({
      id: "sub_test",
      status,
      customer: "cus_test",
      livemode: false,
      metadata: { workspace_id: "workspace-example" },
      cancel_at: null,
      cancel_at_period_end: false,
      pause_collection: null,
      items: {
        data: [{
          price: { id: "price_test", product: "prod_test" },
          quantity: 1,
          current_period_start: 1_791_400_000,
          current_period_end: 1_794_000_000,
        }],
      },
    } as unknown as Stripe.Subscription)

    expect(normalize("active").status).toBe("active")
    expect(normalize("trialing").status).toBe("trialing")
    expect(normalize("past_due").status).toBe("past_due")
    expect(normalize("incomplete").status).toBe("pending")
    expect(normalize("incomplete_expired").status).toBe("expired")
    expect(normalize("unpaid").status).toBe("unpaid")
    expect(normalize("future_status")).toMatchObject({ status: "pending", issueCode: "unsupported_subscription_status" })
  })

  it("fails closed when Stripe pauses collection or exposes unsupported subscription items", () => {
    const base = {
      id: "sub_test",
      status: "active",
      customer: "cus_test",
      livemode: false,
      metadata: {},
      cancel_at: null,
      cancel_at_period_end: false,
      items: { data: [{ price: { id: "price_test", product: "prod_test" }, quantity: 1, current_period_start: 100, current_period_end: 200 }] },
    }
    expect(normalizeStripeSubscription({ ...base, pause_collection: { behavior: "void" } } as unknown as Stripe.Subscription))
      .toMatchObject({ status: "paused", issueCode: "payment_collection_paused", collectionPaused: true })
    expect(() => normalizeStripeSubscription({ ...base, items: { data: [] } } as unknown as Stripe.Subscription))
      .toThrow(/exactly one registered recurring item/)
  })

  it("normalizes Stripe schedule phases without applying a future plan early", () => {
    const subscription = {
      id: "sub_test",
      status: "active",
      customer: "cus_test",
      livemode: false,
      metadata: {},
      cancel_at: null,
      cancel_at_period_end: false,
      pause_collection: null,
      items: { data: [{ price: { id: "price_current", product: "prod_current" }, quantity: 1, current_period_start: 100, current_period_end: 200 }] },
      schedule: {
        status: "active",
        livemode: false,
        id: "sub_sched_placedj",
        metadata: {
          billing_provider: "stripe",
          billing_integration: "placedj",
          billing_mutation_id: "mutation-scheduled",
          billing_target_plan_key: "starter",
          billing_target_interval: "year",
        },
        current_phase: { start_date: 100, end_date: 200 },
        phases: [
          { start_date: 100, end_date: 200, items: [{ price: "price_current", quantity: 1 }] },
          { start_date: 200, end_date: 300, items: [{ price: "price_target", quantity: 1 }] },
        ],
      },
    }
    expect(normalizeStripeSubscription(subscription as unknown as Stripe.Subscription)).toMatchObject({
      scheduledPlan: { priceId: "price_target", effectiveAt: new Date(200_000).toISOString() },
      scheduleId: "sub_sched_placedj",
      customData: {
        billing_schedule_mutation_id: "mutation-scheduled",
        billing_schedule_mutation_kind: "scheduled_plan_change",
        billing_schedule_target_plan_key: "starter",
        billing_schedule_target_interval: "year",
      },
    })
  })

  it("does not expose or adopt a schedule that is not marked as PlaceDJ-managed", () => {
    const subscription = {
      id: "sub_test",
      status: "active",
      customer: "cus_test",
      livemode: false,
      metadata: {},
      cancel_at: null,
      cancel_at_period_end: false,
      pause_collection: null,
      items: { data: [{ price: { id: "price_current", product: "prod_current" }, quantity: 1, current_period_start: 100, current_period_end: 200 }] },
      schedule: {
        id: "sub_sched_external",
        status: "active",
        livemode: false,
        metadata: { billing_provider: "stripe", billing_integration: "another_app" },
        current_phase: { start_date: 100, end_date: 200 },
        phases: [
          { start_date: 100, end_date: 200, items: [{ price: "price_current", quantity: 1 }] },
          { start_date: 200, end_date: 300, items: [{ price: "price_external", quantity: 1 }] },
        ],
      },
    }
    expect(normalizeStripeSubscription(subscription as unknown as Stripe.Subscription)).toMatchObject({
      issueCode: "unmanaged_subscription_schedule",
      scheduleId: null,
      scheduledPlan: null,
    })
  })

  it("blocks mutation calls in deferred mode while continuing to verify webhooks", async () => {
    configureStripeSandbox()
    vi.stubEnv("SAAS_CORE_BILLING_MODE", "deferred")
    expect(() => assertBillingMutationsEnabled()).toThrowError(BillingConfigurationError)

    const adapter = createStripeBillingAdapter()
    await expect(adapter.createCheckoutSession(checkoutRequest)).rejects.toMatchObject({ code: "BILLING_DEFERRED" })
    await expect(adapter.verifyWebhook('{"id":"evt_test","object":"event"}', "t=1,v1=invalid"))
      .rejects.toThrow(/signature/i)
  })

  it("verifies Stripe webhook signatures over the exact raw request body", async () => {
    configureStripeSandbox()
    const secret = "whsec_placeholder"
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", secret)
    const rawBody = JSON.stringify({
      id: "evt_signed_sandbox",
      object: "event",
      api_version: "2026-09-30.endive",
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: "in_signed_sandbox", object: "invoice" } },
      livemode: false,
      pending_webhooks: 1,
      type: "invoice.paid",
    })
    const timestamp = Math.floor(Date.now() / 1000)
    const digest = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex")
    const signature = `t=${timestamp},v1=${digest}`
    const adapter = createStripeBillingAdapter()

    await expect(adapter.verifyWebhook(rawBody, signature)).resolves.toMatchObject({
      id: "evt_signed_sandbox",
      type: "invoice.paid",
      livemode: false,
    })
    await expect(adapter.verifyWebhook(`${rawBody} `, signature)).rejects.toThrow(/signature/i)
  })
})
