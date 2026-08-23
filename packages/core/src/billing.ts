import { createHmac, timingSafeEqual } from "node:crypto"
import { CoreError } from "./errors.js"
import type { Subscription } from "./types.js"

export type BillingEnvironment = "sandbox" | "live"
export type BillingInterval = "month" | "year"

export type BillingProvider = {
  readonly name: "paddle" | (string & {})
  createCheckout(input: { customerId?: string | null; priceId: string; returnUrl: string }): Promise<{ checkoutUrl: string }>
  createPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ portalUrl: string }>
  cancelAtPeriodEnd(subscriptionId: string): Promise<void>
}

export type NormalizedBillingEvent = {
  eventId: string
  eventType: string
  occurredAt: string
  workspaceId: string | null
  providerSubscriptionId: string | null
  data: Record<string, unknown>
}

export function verifyHmacWebhook(rawBody: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex")
  const actual = signature.replace(/^sha256=/, "")
  const expectedBuffer = Buffer.from(expected, "utf8")
  const actualBuffer = Buffer.from(actual, "utf8")
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer)
}

export function assertWebhookSignature(rawBody: string, signature: string, secret: string): void {
  if (!verifyHmacWebhook(rawBody, signature, secret)) throw new CoreError("BILLING_UNAVAILABLE", "Webhook signature could not be verified.")
}

/** Paddle's signed header is `ts=<unix>;h1=<hex>` and signs `ts:rawBody`. */
export function verifyPaddleWebhookSignature(rawBody: string, signature: string, secret: string, now = Date.now(), toleranceSeconds = 300): boolean {
  const values = new Map<string, string[]>()
  for (const segment of signature.split(";")) {
    const [key, value] = segment.split("=", 2)
    if (!key || !value) continue
    values.set(key, [...(values.get(key) ?? []), value])
  }
  const timestamp = Number(values.get("ts")?.[0])
  if (!Number.isFinite(timestamp) || Math.abs(Math.floor(now / 1000) - timestamp) > toleranceSeconds) return false
  const expected = createHmac("sha256", secret).update(`${timestamp}:${rawBody}`).digest("hex")
  return (values.get("h1") ?? []).some((candidate) => {
    const expectedBuffer = Buffer.from(expected, "utf8")
    const candidateBuffer = Buffer.from(candidate, "utf8")
    return expectedBuffer.length === candidateBuffer.length && timingSafeEqual(expectedBuffer, candidateBuffer)
  })
}

export function assertPaddleWebhookSignature(rawBody: string, signature: string, secret: string, now = Date.now()): void {
  if (!verifyPaddleWebhookSignature(rawBody, signature, secret, now)) throw new CoreError("BILLING_UNAVAILABLE", "Webhook signature could not be verified.")
}

export function shouldApplyProviderEvent(subscription: Subscription, event: NormalizedBillingEvent): boolean {
  if (!subscription.lastProviderEventAt) return true
  return new Date(event.occurredAt).getTime() > new Date(subscription.lastProviderEventAt).getTime()
}

export function applyProviderSubscriptionEvent(subscription: Subscription, event: NormalizedBillingEvent, patch: Partial<Subscription>): Subscription {
  if (!shouldApplyProviderEvent(subscription, event)) return subscription
  return { ...subscription, ...patch, lastProviderEventAt: event.occurredAt, lastProviderEventId: event.eventId }
}

export class PaddleBillingProvider implements BillingProvider {
  readonly name = "paddle" as const
  constructor(private readonly input: { apiKey: string; baseUrl?: string; fetcher?: typeof fetch }) {}

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const fetcher = this.input.fetcher ?? fetch
    const response = await fetcher(`${this.input.baseUrl ?? "https://api.paddle.com"}${path}`, { ...init, headers: { Authorization: `Bearer ${this.input.apiKey}`, "Content-Type": "application/json", ...(init.headers ?? {}) } })
    if (!response.ok) throw new CoreError("BILLING_UNAVAILABLE", "Billing provider request failed.", { status: response.status })
    return response.json() as Promise<T>
  }

  async createCheckout(input: { customerId?: string | null; priceId: string; returnUrl: string }) {
    // Paddle checkout is intentionally created by a server-side provider adapter.
    const result = await this.request<{ data: { id: string } }>("/transactions", { method: "POST", body: JSON.stringify({ items: [{ price_id: input.priceId, quantity: 1 }], customer_id: input.customerId ?? undefined, checkout: { url: input.returnUrl } }) })
    return { checkoutUrl: `${input.returnUrl}?transaction=${encodeURIComponent(result.data.id)}` }
  }

  async createPortalSession(input: { customerId: string; returnUrl: string }) {
    const result = await this.request<{ data: { url: string } }>(`/customers/${encodeURIComponent(input.customerId)}/portal-sessions`, { method: "POST", body: JSON.stringify({}) })
    return { portalUrl: result.data.url }
  }

  async cancelAtPeriodEnd(subscriptionId: string) {
    await this.request(`/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: "PATCH", body: JSON.stringify({ scheduled_change: { action: "cancel", resume_at: null } }) })
  }
}
