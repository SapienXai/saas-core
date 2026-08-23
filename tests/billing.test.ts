import { createHmac } from "node:crypto"
import { describe, expect, it } from "vitest"
import type { BillingWebhookRecord, Subscription } from "../packages/core/src/index.js"
import { buildGraceLifecyclePatch, createBillingService, processPaddleWebhook } from "../packages/billing/src/index.js"

const subscription: Subscription = {
  workspaceId: "workspace", planKey: "pro", status: "active", source: "paddle", provider: "paddle", providerEnvironment: "sandbox",
  providerCustomerId: "customer", providerSubscriptionId: "subscription", currentPeriodStart: null, currentPeriodEnd: null,
  scheduledPlanKey: null, scheduledPlanAt: null, paymentFailureStartedAt: null, paymentGraceEndsAt: null, billingIssueCode: null,
  lastProviderEventAt: null, lastProviderEventId: null,
}

class MemoryWebhookStore {
  readonly events = new Map<string, BillingWebhookRecord>()
  async insert(record: BillingWebhookRecord) { const existing = this.events.get(record.providerEventId); if (existing) return { inserted: false, record: existing }; this.events.set(record.providerEventId, { ...record }); return { inserted: true, record } }
  async markProcessing(eventId: string) { const event = this.events.get(eventId)!; event.status = "processing"; event.attempts += 1 }
  async markProcessed(eventId: string) { const event = this.events.get(eventId)!; event.status = "processed"; event.processedAt = new Date().toISOString() }
  async markIgnored(eventId: string, reason: string) { const event = this.events.get(eventId)!; event.status = "ignored"; event.errorMessage = reason }
  async markFailed(eventId: string, error: { code: string; message: string }) { const event = this.events.get(eventId)!; event.status = "failed"; event.errorCode = error.code; event.errorMessage = error.message }
}

describe("billing production boundaries", () => {
  it("resolves a server-side Core price mapping and never accepts a browser price id", async () => {
    const calls: Array<{ priceId: string; idempotencyKey?: string }> = []
    const service = createBillingService({
      environment: "sandbox",
      mappings: [{ planKey: "pro", interval: "year", currency: "USD", environment: "sandbox", providerPriceId: "pri_server_pro_year" }],
      provider: { name: "paddle", createCheckout: async (input) => { calls.push(input); return { checkoutUrl: "https://checkout.example/transaction" } }, createPortalSession: async () => ({ portalUrl: "https://portal.example" }), cancelAtPeriodEnd: async () => {} },
    })
    await service.createCheckout({ planKey: "pro", interval: "year", currency: "USD", returnUrl: "https://app.example/billing" })
    expect(calls[0]?.priceId).toBe("pri_server_pro_year")
    expect(calls[0]?.idempotencyKey).toContain("pro:year")
  })

  it("verifies raw webhook signatures and processes each event once", async () => {
    const raw = JSON.stringify({ event_id: "evt_1", event_type: "subscription.updated", occurred_at: "2026-08-24T10:00:00.000Z", data: { id: "sub_1" } })
    const timestamp = Math.floor(Date.now() / 1000)
    const signature = `ts=${timestamp};h1=${createHmac("sha256", "secret").update(`${timestamp}:${raw}`).digest("hex")}`
    const store = new MemoryWebhookStore(); let applied = 0
    const first = await processPaddleWebhook({ rawBody: raw, signature, secret: "secret", store, apply: async () => { applied += 1 } })
    const second = await processPaddleWebhook({ rawBody: raw, signature, secret: "secret", store, apply: async () => { applied += 1 } })
    expect(first).toBe("processed")
    expect(second).toBe("duplicate")
    expect(applied).toBe(1)
    expect(store.events.get("evt_1")?.attempts).toBe(1)
  })

  it("returns a deterministic grace-expiry patch without deleting provider state", () => {
    const patch = buildGraceLifecyclePatch({ ...subscription, status: "past_due", paymentGraceEndsAt: "2026-08-01T00:00:00.000Z" }, new Date("2026-08-24T00:00:00.000Z"))
    expect(patch).toEqual({ planKey: "free", billingIssueCode: "grace_expired" })
  })
})
