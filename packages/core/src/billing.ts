import { createHmac, timingSafeEqual } from "node:crypto"
import { CoreError } from "./errors.js"
import type { Subscription } from "./types.js"

export type BillingEnvironment = "sandbox" | "live"
export type BillingInterval = "month" | "year"

export type PaddlePriceMapping = {
  planKey: string
  interval: BillingInterval
  currency: string
  environment: BillingEnvironment
  providerPriceId: string
  active?: boolean
}

export function readPaddlePriceMappings(env: NodeJS.ProcessEnv = process.env): PaddlePriceMapping[] {
  const environment = (env.PADDLE_ENVIRONMENT === "live" ? "live" : "sandbox") as BillingEnvironment
  const currency = (env.PADDLE_CURRENCY ?? "USD").toUpperCase()
  const plans = ["starter", "pro", "business"]
  const intervals: BillingInterval[] = ["month", "year"]
  return plans.flatMap((planKey) => intervals.flatMap((interval) => {
    const envKey = `PADDLE_PRICE_${planKey.toUpperCase()}_${interval.toUpperCase()}`
    const providerPriceId = env[envKey]?.trim()
    return providerPriceId ? [{ planKey, interval, currency, environment, providerPriceId }] : []
  }))
}

export type PaddleSubscriptionSnapshot = {
  providerSubscriptionId: string
  providerCustomerId: string | null
  environment: BillingEnvironment
  status: Subscription["status"]
  planKey: string
  providerPriceId: string
  interval: BillingInterval
  currency: string
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  scheduledPlanKey: string | null
  scheduledPlanAt: string | null
  occurredAt: string
}

export type BillingWebhookRecord = {
  provider: "paddle"
  providerEventId: string
  eventType: string
  occurredAt: string
  payload: Record<string, unknown>
  status: "received" | "processing" | "processed" | "ignored" | "failed"
  attempts: number
  errorCode: string | null
  errorMessage: string | null
  processedAt: string | null
}

export type BillingWebhookStore = {
  insert(record: BillingWebhookRecord): Promise<{ inserted: boolean; record: BillingWebhookRecord }>
  markProcessing(eventId: string): Promise<void>
  markProcessed(eventId: string): Promise<void>
  markIgnored(eventId: string, reason: string): Promise<void>
  markFailed(eventId: string, error: { code: string; message: string }): Promise<void>
}

export function resolvePaddlePrice(input: { planKey: string; interval: BillingInterval; currency: string; environment: BillingEnvironment; mappings: Iterable<PaddlePriceMapping> }): PaddlePriceMapping {
  const match = [...input.mappings].find((mapping) => mapping.active !== false && mapping.planKey === input.planKey && mapping.interval === input.interval && mapping.currency.toUpperCase() === input.currency.toUpperCase() && mapping.environment === input.environment)
  if (!match) throw new CoreError("BILLING_UNAVAILABLE", "No active provider price is registered for the requested Core plan.", { planKey: input.planKey, interval: input.interval, currency: input.currency, environment: input.environment })
  return match
}

export function getPaymentGraceEndsAt(startedAt: string, days = 14): string {
  const start = new Date(startedAt)
  if (!Number.isFinite(start.getTime())) throw new CoreError("BILLING_UNAVAILABLE", "Payment failure timestamp is invalid.")
  return new Date(start.getTime() + days * 86400000).toISOString()
}

export function isPaymentGraceExpired(graceEndsAt: string | null | undefined, now = new Date()): boolean {
  if (!graceEndsAt) return false
  const end = new Date(graceEndsAt)
  return Number.isFinite(end.getTime()) && end.getTime() <= now.getTime()
}

export function applyPaddleSubscriptionSnapshot(subscription: Subscription, snapshot: PaddleSubscriptionSnapshot, now = new Date()): Subscription {
  if (subscription.lastProviderEventAt && new Date(snapshot.occurredAt).getTime() <= new Date(subscription.lastProviderEventAt).getTime()) return subscription
  const paymentFailureStartedAt = snapshot.status === "past_due" ? subscription.paymentFailureStartedAt ?? snapshot.occurredAt : null
  const paymentGraceEndsAt = paymentFailureStartedAt ? subscription.paymentGraceEndsAt ?? getPaymentGraceEndsAt(paymentFailureStartedAt) : null
  const graceExpired = snapshot.status === "past_due" && isPaymentGraceExpired(paymentGraceEndsAt, now)
  return {
    ...subscription,
    planKey: graceExpired || snapshot.status === "paused" || snapshot.status === "canceled" ? "free" : snapshot.planKey,
    status: snapshot.status,
    source: "paddle",
    provider: "paddle",
    providerEnvironment: snapshot.environment,
    providerCustomerId: snapshot.providerCustomerId,
    providerSubscriptionId: snapshot.providerSubscriptionId,
    currentPeriodStart: snapshot.currentPeriodStart,
    currentPeriodEnd: snapshot.currentPeriodEnd,
    scheduledPlanKey: snapshot.scheduledPlanKey,
    scheduledPlanAt: snapshot.scheduledPlanAt,
    billingInterval: snapshot.interval,
    billingCurrency: snapshot.currency,
    providerPriceId: snapshot.providerPriceId,
    paymentFailureStartedAt,
    paymentGraceEndsAt,
    billingIssueCode: snapshot.status === "past_due" ? (graceExpired ? "grace_expired" : "past_due") : null,
    lastProviderEventAt: snapshot.occurredAt,
    lastProviderEventId: `paddle:${snapshot.providerSubscriptionId}:${snapshot.occurredAt}`,
  }
}

export function subscriptionNeedsReconciliation(input: { local: Subscription; provider: PaddleSubscriptionSnapshot }): string[] {
  const differences: string[] = []
  if (input.local.providerSubscriptionId !== input.provider.providerSubscriptionId) differences.push("provider_subscription_id")
  if (input.local.status !== input.provider.status) differences.push("status")
  if (input.local.providerPriceId !== input.provider.providerPriceId) differences.push("provider_price_id")
  if (input.local.billingInterval !== input.provider.interval) differences.push("interval")
  if (input.local.billingCurrency?.toUpperCase() !== input.provider.currency.toUpperCase()) differences.push("currency")
  if (input.local.scheduledPlanKey !== input.provider.scheduledPlanKey) differences.push("scheduled_plan")
  if (input.local.scheduledPlanAt !== input.provider.scheduledPlanAt) differences.push("scheduled_effective_at")
  return differences
}

export async function processDurableBillingWebhook(input: {
  store: BillingWebhookStore
  record: BillingWebhookRecord
  apply: (record: BillingWebhookRecord) => Promise<void>
}): Promise<"processed" | "duplicate" | "ignored" | "failed"> {
  const inserted = await input.store.insert(input.record)
  if (!inserted.inserted || inserted.record.status === "processed" || inserted.record.status === "ignored") return inserted.record.status === "processed" ? "duplicate" : "ignored"
  await input.store.markProcessing(input.record.providerEventId)
  try {
    await input.apply(input.record)
    await input.store.markProcessed(input.record.providerEventId)
    return "processed"
  } catch (error) {
    const message = error instanceof Error ? error.message : "Billing webhook processing failed."
    await input.store.markFailed(input.record.providerEventId, { code: error instanceof CoreError ? error.code : "BILLING_PROCESSING_FAILED", message })
    return "failed"
  }
}

export type BillingProvider = {
  readonly name: "paddle" | (string & {})
  createCheckout(input: { customerId?: string | null; priceId: string; returnUrl: string; idempotencyKey?: string }): Promise<{ checkoutUrl: string }>
  createPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ portalUrl: string }>
  cancelAtPeriodEnd(subscriptionId: string): Promise<void>
  resume?(subscriptionId: string): Promise<void>
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

  async createCheckout(input: { customerId?: string | null; priceId: string; returnUrl: string; idempotencyKey?: string }) {
    const result = await this.request<{ data: { id: string } }>("/transactions", { method: "POST", headers: input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}, body: JSON.stringify({ items: [{ price_id: input.priceId, quantity: 1 }], customer_id: input.customerId ?? undefined, checkout: { url: input.returnUrl } }) })
    return { checkoutUrl: `${input.returnUrl}?transaction=${encodeURIComponent(result.data.id)}` }
  }

  async createPortalSession(input: { customerId: string; returnUrl: string }) {
    const result = await this.request<{ data: { url: string } }>(`/customers/${encodeURIComponent(input.customerId)}/portal-sessions`, { method: "POST", body: JSON.stringify({}) })
    return { portalUrl: result.data.url }
  }

  async cancelAtPeriodEnd(subscriptionId: string) {
    await this.request(`/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: "PATCH", body: JSON.stringify({ scheduled_change: { action: "cancel", resume_at: null } }) })
  }

  async resume(subscriptionId: string) {
    await this.request(`/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: "PATCH", body: JSON.stringify({ scheduled_change: null }) })
  }
}

export async function createMappedCheckout(input: {
  provider: BillingProvider
  planKey: string
  interval: BillingInterval
  currency: string
  environment: BillingEnvironment
  mappings: Iterable<PaddlePriceMapping>
  customerId?: string | null
  returnUrl: string
}) {
  const mapping = resolvePaddlePrice(input)
  return input.provider.createCheckout({ customerId: input.customerId ?? null, priceId: mapping.providerPriceId, returnUrl: input.returnUrl, idempotencyKey: `${input.planKey}:${input.interval}:${input.customerId ?? "new"}:${input.returnUrl}` })
}
