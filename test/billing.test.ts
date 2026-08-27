import { createHmac } from "node:crypto"
import { describe, expect, it } from "vitest"
import { Environment, Paddle } from "@paddle/paddle-node-sdk"
import {
  getSubscriptionPlanForStatus,
  normalizePaddleEvent,
  normalizeSubscriptionData,
} from "../lib/billing/webhook"
import { getPaymentGraceEndsAt, isPaymentGraceExpired } from "../lib/billing/lifecycle"
import { isBillingInterval } from "../lib/billing/price-mapping"
import { GET, POST } from "../app/api/billing/paddle/webhook/route"

describe("Paddle billing boundaries", () => {
  it("normalizes current SDK and webhook subscription shapes", () => {
    const subscription = normalizeSubscriptionData({
      id: "sub_test",
      status: "active",
      customerId: "ctm_test",
      nextBilledAt: "2026-09-01T00:00:00Z",
      currentBillingPeriod: { startsAt: "2026-08-01T00:00:00Z", endsAt: "2026-09-01T00:00:00Z" },
      scheduledChange: { action: "cancel", effectiveAt: "2026-09-01T00:00:00Z", resumeAt: null },
      customData: { saas_core_workspace_id: "workspace" },
      items: [{ price: { id: "pri_test" }, quantity: 1 }],
    })
    expect(subscription).toMatchObject({
      id: "sub_test",
      status: "active",
      customerId: "ctm_test",
      items: [{ priceId: "pri_test", quantity: 1 }],
      scheduledChange: { action: "cancel" },
    })

    const legacyShape = normalizeSubscriptionData({
      id: "sub_legacy",
      status: "past_due",
      current_billing_period: { starts_at: "2026-08-01T00:00:00Z", ends_at: "2026-09-01T00:00:00Z" },
      items: [{ price_id: "pri_legacy", quantity: 1 }],
    })
    expect(legacyShape.items[0]?.priceId).toBe("pri_legacy")
    expect(legacyShape.status).toBe("past_due")
  })

  it("keeps paid access during recovery and falls back to Free only when inactive", () => {
    expect(getSubscriptionPlanForStatus("active", "starter")).toBe("starter")
    expect(getSubscriptionPlanForStatus("trialing", "pro")).toBe("pro")
    expect(getSubscriptionPlanForStatus("past_due", "business")).toBe("business")
    expect(getSubscriptionPlanForStatus("paused", "pro")).toBe("free")
    expect(getSubscriptionPlanForStatus("canceled", "starter")).toBe("free")
  })

  it("projects a deterministic fourteen-day payment recovery window", () => {
    const graceEndsAt = getPaymentGraceEndsAt("2026-08-01T10:00:00Z")
    expect(graceEndsAt).toBe("2026-08-15T10:00:00.000Z")
    expect(isPaymentGraceExpired(graceEndsAt, new Date("2026-08-15T09:59:59Z"))).toBe(false)
    expect(isPaymentGraceExpired(graceEndsAt, new Date("2026-08-15T10:00:00Z"))).toBe(true)
  })

  it("accepts only the configured billing intervals", () => {
    expect(isBillingInterval("month")).toBe(true)
    expect(isBillingInterval("year")).toBe(true)
    expect(isBillingInterval("quarter")).toBe(false)
    expect(isBillingInterval("monthly")).toBe(false)
  })

  it("normalizes verified event metadata without changing the raw payload", () => {
    const event = normalizePaddleEvent({
      eventId: "evt_test",
      eventType: "subscription.activated",
      occurredAt: "2026-08-09T10:00:00Z",
      data: { id: "sub_test" },
    })
    expect(event).toEqual({
      eventId: "evt_test",
      eventType: "subscription.activated",
      occurredAt: "2026-08-09T10:00:00Z",
      data: { id: "sub_test" },
    })
  })

  it("verifies the exact raw body using the official Paddle SDK helper", async () => {
    const rawBody = JSON.stringify({
      event_id: "evt_signature",
      event_type: "saas-core.test.event",
      occurred_at: "2026-08-09T10:00:00Z",
      data: { marker: "raw-body" },
    })
    const secret = "local-webhook-secret"
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const signature = createHmac("sha256", secret).update(`${timestamp}:${rawBody}`).digest("hex")
    const header = `ts=${timestamp};h1=${signature}`
    const verifier = new Paddle("webhook-test-key", { environment: Environment.sandbox })

    await expect(verifier.webhooks.unmarshal(rawBody, secret, header)).resolves.toMatchObject({ eventId: "evt_signature" })
    await expect(verifier.webhooks.unmarshal(JSON.stringify({ event_id: "tampered" }), secret, header)).rejects.toThrow()
  })

  it("rejects unsigned webhook requests and non-POST methods", async () => {
    const unsigned = await POST(new Request("http://localhost/api/billing/paddle/webhook", { method: "POST", body: "{}" }))
    expect(unsigned.status).toBe(400)
    const get = await GET()
    expect(get.status).toBe(405)
  })
})
