import {
  assertPaddleWebhookSignature,
  createMappedCheckout,
  getPaymentGraceEndsAt,
  isPaymentGraceExpired,
  processDurableBillingWebhook,
  type BillingEnvironment,
  type BillingProvider,
  type BillingWebhookRecord,
  type BillingWebhookStore,
  type BillingInterval,
  type PaddlePriceMapping,
  type PaddleSubscriptionSnapshot,
  type Subscription,
} from "@sapienx/saas-core"

export * from "@sapienx/saas-core"

export type NormalizedPaddleEvent = { eventId: string; eventType: string; occurredAt: string; data: Record<string, unknown> }
export type ReconciliationResult = { status: "in_sync" | "mismatch"; differences: string[]; local: Subscription; provider: PaddleSubscriptionSnapshot }

function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function stringValue(value: unknown): string | null { return typeof value === "string" && value.length > 0 ? value : null }

export function normalizePaddleEvent(payload: unknown): NormalizedPaddleEvent {
  const root = record(payload); const eventId = stringValue(root.event_id ?? root.eventId); const eventType = stringValue(root.event_type ?? root.eventType); const occurredAt = stringValue(root.occurred_at ?? root.occurredAt); const data = record(root.data)
  if (!eventId || !eventType || !occurredAt) throw new Error("Paddle event metadata is incomplete.")
  if (!Number.isFinite(new Date(occurredAt).getTime())) throw new Error("Paddle event timestamp is invalid.")
  return { eventId, eventType, occurredAt, data }
}

export function normalizePaddleSubscription(input: { event: NormalizedPaddleEvent; environment: BillingEnvironment; planKey: string; interval: BillingInterval; currency: string }): PaddleSubscriptionSnapshot {
  const data = input.event.data; const id = stringValue(data.id); const status = stringValue(data.status) as Subscription["status"] | null; const price = record((Array.isArray(data.items) ? data.items[0] : null) && record((Array.isArray(data.items) ? data.items[0] : null)).price); const providerPriceId = stringValue(price.id)
  if (!id || !status || !providerPriceId || !["active", "trialing", "past_due", "paused", "canceled"].includes(status)) throw new Error("Paddle subscription payload is incomplete.")
  const period = record(data.current_billing_period ?? data.currentBillingPeriod); const scheduled = record(data.scheduled_change ?? data.scheduledChange); const scheduledAction = stringValue(scheduled.action)
  return { providerSubscriptionId: id, providerCustomerId: stringValue(data.customer_id ?? data.customerId), environment: input.environment, status, planKey: input.planKey, providerPriceId, interval: input.interval, currency: input.currency, currentPeriodStart: stringValue(period.starts_at ?? period.startsAt), currentPeriodEnd: stringValue(period.ends_at ?? period.endsAt), scheduledPlanKey: scheduledAction === "cancel" ? "free" : null, scheduledPlanAt: stringValue(scheduled.effective_at ?? scheduled.effectiveAt), occurredAt: input.event.occurredAt }
}

export async function verifyAndNormalizePaddleWebhook(rawBody: string, signature: string, secret: string, now = Date.now()): Promise<NormalizedPaddleEvent> {
  assertPaddleWebhookSignature(rawBody, signature, secret, now)
  return normalizePaddleEvent(JSON.parse(rawBody) as unknown)
}

export async function processPaddleWebhook(input: { rawBody: string; signature: string; secret: string; store: BillingWebhookStore; apply: (event: NormalizedPaddleEvent) => Promise<void>; now?: Date }): Promise<"processed" | "duplicate" | "ignored" | "failed"> {
  const event = await verifyAndNormalizePaddleWebhook(input.rawBody, input.signature, input.secret, input.now?.getTime())
  const record: BillingWebhookRecord = { provider: "paddle", providerEventId: event.eventId, eventType: event.eventType, occurredAt: event.occurredAt, payload: event.data, status: "received", attempts: 0, errorCode: null, errorMessage: null, processedAt: null }
  return processDurableBillingWebhook({ store: input.store, record, apply: async () => input.apply(event) })
}

export function buildGraceLifecyclePatch(subscription: Subscription, now = new Date()): Partial<Subscription> | null {
  if (subscription.status !== "past_due" || !subscription.paymentGraceEndsAt || !isPaymentGraceExpired(subscription.paymentGraceEndsAt, now)) return null
  return { planKey: "free", billingIssueCode: "grace_expired" }
}

export function getGraceDeadline(paymentFailureStartedAt: string, days = 14) { return getPaymentGraceEndsAt(paymentFailureStartedAt, days) }

export function createBillingService(input: { provider: BillingProvider; mappings: Iterable<PaddlePriceMapping>; environment: BillingEnvironment }) {
  return {
    createCheckout(request: { planKey: string; interval: BillingInterval; currency: string; customerId?: string | null; returnUrl: string }) {
      return createMappedCheckout({ provider: input.provider, mappings: input.mappings, environment: input.environment, ...request })
    },
    reconcile(local: Subscription, provider: PaddleSubscriptionSnapshot): ReconciliationResult {
      const differences: string[] = []
      if (local.providerSubscriptionId !== provider.providerSubscriptionId) differences.push("provider_subscription_id")
      if (local.status !== provider.status) differences.push("status")
      if (local.providerPriceId !== provider.providerPriceId) differences.push("provider_price_id")
      if (local.billingInterval !== provider.interval) differences.push("interval")
      if ((local.billingCurrency ?? "").toUpperCase() !== provider.currency.toUpperCase()) differences.push("currency")
      return { status: differences.length ? "mismatch" : "in_sync", differences, local, provider }
    },
  }
}
