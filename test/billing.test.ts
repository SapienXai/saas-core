import { afterEach, describe, expect, it, vi } from "vitest"
import Stripe from "stripe"
import { getPaymentGraceEndsAt, isPaymentGraceExpired } from "../lib/billing/lifecycle"
import { isBillingInterval } from "../lib/billing/price-mapping"
import { createStripeBillingAdapter, STRIPE_API_VERSION } from "../lib/billing/providers/stripe"
import { normalizeStripeEvent } from "../lib/billing/stripe-webhook"
import { GET, POST } from "../app/api/billing/stripe/webhook/route"

afterEach(() => vi.unstubAllEnvs())

function configureStripeSandbox() {
  vi.stubEnv("STRIPE_ENVIRONMENT", "sandbox")
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_placeholder")
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_placeholder")
  vi.stubEnv("STRIPE_ACCOUNT_ID", "acct_1Tvn6tDKdVwvpd8n")
  vi.stubEnv("STRIPE_BILLING_PORTAL_CONFIGURATION_ID", "bpc_testunit")
}

describe("Stripe billing boundaries", () => {
  it("normalizes verified Stripe event metadata without changing its raw payload", () => {
    const event = normalizeStripeEvent({
      id: "evt_test",
      type: "customer.subscription.updated",
      created: 1_791_400_000,
      livemode: false,
      data: { object: { id: "sub_test", object: "subscription", metadata: { workspace_id: "9d342cbb-49d6-4614-bd5c-01c266d1511e" } } },
    })
    expect(event).toMatchObject({
      eventId: "evt_test",
      eventType: "customer.subscription.updated",
      objectId: "sub_test",
      subscriptionId: "sub_test",
      workspaceId: "9d342cbb-49d6-4614-bd5c-01c266d1511e",
    })
  })

  it("verifies the exact raw body using Stripe's official webhook signature helper", async () => {
    configureStripeSandbox()
    const rawBody = JSON.stringify({
      id: "evt_signature",
      object: "event",
      api_version: STRIPE_API_VERSION,
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: "cs_test_signature", object: "checkout.session", mode: "subscription", status: "complete", payment_status: "paid", livemode: false } },
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type: "checkout.session.completed",
    })
    const secret = "whsec_placeholder"
    const signer = new Stripe("sk_test_placeholder", { apiVersion: STRIPE_API_VERSION })
    const signature = signer.webhooks.generateTestHeaderString({ payload: rawBody, secret })

    await expect(createStripeBillingAdapter().verifyWebhook(rawBody, signature)).resolves.toMatchObject({ id: "evt_signature", livemode: false })
    await expect(createStripeBillingAdapter().verifyWebhook(rawBody.replace("evt_signature", "evt_tampered"), signature)).rejects.toThrow()
  })

  it("projects a deterministic fourteen-day payment recovery window", () => {
    const graceEndsAt = getPaymentGraceEndsAt("2026-08-01T10:00:00Z")
    expect(graceEndsAt).toBe("2026-08-15T10:00:00.000Z")
    expect(isPaymentGraceExpired(graceEndsAt, new Date("2026-08-15T09:59:59Z"))).toBe(false)
    expect(isPaymentGraceExpired(graceEndsAt, new Date("2026-08-15T10:00:00Z"))).toBe(true)
  })

  it("accepts only configured billing intervals", () => {
    expect(isBillingInterval("month")).toBe(true)
    expect(isBillingInterval("year")).toBe(true)
    expect(isBillingInterval("quarter")).toBe(false)
    expect(isBillingInterval("monthly")).toBe(false)
  })

  it("rejects unsigned webhook requests and non-POST methods", async () => {
    const unsigned = await POST(new Request("http://localhost/api/billing/stripe/webhook", { method: "POST", body: "{}" }))
    expect(unsigned.status).toBe(400)
    const get = await GET()
    expect(get.status).toBe(405)
  })
})
