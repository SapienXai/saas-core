import "server-only"

import { randomUUID } from "node:crypto"
import type { PlanKey } from "@/lib/entitlements"
import { createServiceRoleClient } from "@/lib/supabase"
import {
  BILLING_PROVIDER,
  compareBillingEventOrder,
  getConfiguredFallbackPlanKey,
  isBillingEnvironmentMatch,
  isTerminalBillingSubscription,
  projectCanonicalSubscription,
  type CanonicalSubscription,
} from "./reconciliation"
import { getPaddlePriceByProviderId, isPaidPlanKey, type PaidPlanKey } from "./price-mapping"
import { getBillingEnvironment } from "./paddle-client"
import {
  claimBillingWebhookEvent,
  finalizeBillingWebhookEvent,
  recordBillingWebhookEvent,
  upsertBillingProviderAccount,
} from "./persistence"

export type PaddleSubscriptionStatus = CanonicalSubscription["status"]
export type NormalizedPaddleSubscription = CanonicalSubscription

export type NormalizedPaddleEvent = {
  eventId: string
  eventType: string
  occurredAt: string
  data: Record<string, unknown>
}

export class BillingSyncError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "BillingSyncError"
    this.code = code
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function normalizeCustomData(value: unknown): Record<string, unknown> | null {
  const data = asRecord(value)
  return Object.keys(data).length ? data : null
}

function validTimestamp(value: string | null) {
  return Boolean(value && Number.isFinite(new Date(value).getTime()))
}

export function normalizeSubscriptionData(value: unknown): NormalizedPaddleSubscription {
  const data = asRecord(value)
  const status = stringValue(data.status)
  if (!status || !["active", "trialing", "past_due", "paused", "canceled"].includes(status)) {
    throw new BillingSyncError("INVALID_SUBSCRIPTION_STATUS", "Paddle subscription status is not supported.")
  }
  const period = asRecord(data.currentBillingPeriod || data.current_billing_period)
  const scheduled = asRecord(data.scheduledChange || data.scheduled_change)
  const items = Array.isArray(data.items) ? data.items : []
  const scheduledAction = stringValue(scheduled.action)
  if (scheduledAction && !["cancel", "pause", "resume"].includes(scheduledAction)) {
    throw new BillingSyncError("INVALID_SCHEDULED_CHANGE", "Paddle scheduled subscription change is not supported.")
  }
  return {
    id: stringValue(data.id) || "",
    status: status as PaddleSubscriptionStatus,
    customerId: stringValue(data.customerId || data.customer_id),
    nextBilledAt: stringValue(data.nextBilledAt || data.next_billed_at),
    currentBillingPeriod: stringValue(period.startsAt || period.starts_at) && stringValue(period.endsAt || period.ends_at)
      ? { startsAt: stringValue(period.startsAt || period.starts_at) as string, endsAt: stringValue(period.endsAt || period.ends_at) as string }
      : null,
    scheduledChange: scheduledAction && stringValue(scheduled.effectiveAt || scheduled.effective_at)
      ? { action: scheduledAction as "cancel" | "pause" | "resume", effectiveAt: stringValue(scheduled.effectiveAt || scheduled.effective_at) as string, resumeAt: stringValue(scheduled.resumeAt || scheduled.resume_at) }
      : null,
    customData: normalizeCustomData(data.customData || data.custom_data),
    items: items.map((item) => {
      const itemData = asRecord(item)
      const price = asRecord(itemData.price)
      const productId = stringValue(itemData.productId || itemData.product_id || price.productId || price.product_id)
      return {
        priceId: stringValue(itemData.priceId || itemData.price_id || price.id),
        quantity: typeof itemData.quantity === "number" ? itemData.quantity : 1,
        ...(productId ? { productId } : {}),
      }
    }),
  }
}

export function normalizePaddleEvent(event: { eventId?: string; event_id?: string; eventType?: string; event_type?: string; occurredAt?: string; occurred_at?: string; data?: unknown }): NormalizedPaddleEvent {
  const eventId = stringValue(event.eventId || event.event_id)
  const eventType = stringValue(event.eventType || event.event_type)
  const occurredAt = stringValue(event.occurredAt || event.occurred_at)
  if (!eventId || !eventType || !occurredAt || !validTimestamp(occurredAt)) throw new BillingSyncError("INVALID_EVENT", "Paddle webhook event metadata is incomplete or invalid.")
  return { eventId, eventType, occurredAt, data: asRecord(event.data) }
}

export function getSubscriptionObjectId(event: NormalizedPaddleEvent) {
  return stringValue(event.data.id)
}

export function getWorkspaceIdFromEvent(event: NormalizedPaddleEvent) {
  const customData = asRecord(event.data.customData || event.data.custom_data)
  return stringValue(customData.saas_core_workspace_id)
}

export function getSubscriptionPlanForStatus(status: PaddleSubscriptionStatus, purchasedPlan: PaidPlanKey, fallbackPlan: PlanKey = purchasedPlan): PlanKey {
  return status === "paused" || status === "canceled" ? fallbackPlan : purchasedPlan
}

export function getSubscriptionPlanFromPrice(providerPriceId: string | null, environment = getBillingEnvironment()) {
  if (!providerPriceId) return Promise.resolve(null)
  return getPaddlePriceByProviderId(providerPriceId, environment, false)
}

function requireSubscriptionShape(subscription: NormalizedPaddleSubscription) {
  if (!subscription.id) throw new BillingSyncError("INVALID_SUBSCRIPTION", "Paddle subscription ID is missing.")
  if (subscription.items.length !== 1) throw new BillingSyncError("INVALID_ITEMS", "Paddle subscription must contain exactly one recurring item.")
  const item = subscription.items[0]
  if (!item?.priceId || item.quantity !== 1 || !Number.isSafeInteger(item.quantity)) throw new BillingSyncError("INVALID_ITEMS", "Paddle subscription item shape is not supported.")
  if (subscription.currentBillingPeriod && (!validTimestamp(subscription.currentBillingPeriod.startsAt) || !validTimestamp(subscription.currentBillingPeriod.endsAt) || new Date(subscription.currentBillingPeriod.endsAt).getTime() <= new Date(subscription.currentBillingPeriod.startsAt).getTime())) throw new BillingSyncError("INVALID_PERIOD", "Paddle subscription billing period is invalid.")
}

export function validatePaddleSubscriptionShape(subscription: NormalizedPaddleSubscription) {
  requireSubscriptionShape(subscription)
  return true
}

async function applyPaddleTransactionEvent(event: NormalizedPaddleEvent, environment: ReturnType<typeof getBillingEnvironment>) {
  const transactionId = stringValue(event.data.id)
  if (!transactionId) throw new BillingSyncError("INVALID_TRANSACTION", "Paddle transaction ID is missing.")
  const customData = asRecord(event.data.customData || event.data.custom_data)
  const eventEnvironment = stringValue(customData.saas_core_billing_environment)
  if (eventEnvironment && eventEnvironment !== environment) throw new BillingSyncError("ENVIRONMENT_MISMATCH", "Paddle transaction belongs to another billing environment.")
  const workspaceId = stringValue(customData.saas_core_workspace_id)
  const customerId = stringValue(event.data.customerId || event.data.customer_id)
  const status = event.eventType === "transaction.completed" || event.eventType === "transaction.paid" || event.eventType === "transaction.billed" ? "completed" : event.eventType === "transaction.payment_failed" || event.eventType === "transaction.canceled" ? "failed" : null
  if (!status) return { status: "ignored" as const, reason: "UNSUPPORTED_EVENT" as const }
  const supabase = createServiceRoleClient()
  let query = supabase.from("billing_checkout_sessions").update({ status }).eq("provider", BILLING_PROVIDER).eq("environment", environment).eq("provider_transaction_id", transactionId)
  if (workspaceId) query = query.eq("workspace_id", workspaceId)
  const { data, error } = await query.select("workspace_id").maybeSingle()
  if (error) throw new Error(error.message)
  if (data?.workspace_id && customerId) await upsertBillingProviderAccount({ workspaceId: data.workspace_id, provider: BILLING_PROVIDER, environment, providerAccountId: customerId, providerCustomerId: customerId, metadata: { transactionId } })
  return { status: data ? "processed" as const : "ignored" as const, reason: data ? undefined : "UNKNOWN_CHECKOUT" as const, workspaceId: data?.workspace_id || workspaceId || undefined }
}

export async function applyPaddleSubscriptionEvent(event: NormalizedPaddleEvent) {
  const environment = getBillingEnvironment()
  if (event.eventType.startsWith("transaction.")) return applyPaddleTransactionEvent(event, environment)
  if (!event.eventType.startsWith("subscription.")) return { status: "ignored" as const, reason: "UNSUPPORTED_EVENT" as const }
  const subscription = normalizeSubscriptionData(event.data)
  requireSubscriptionShape(subscription)
  const customData = asRecord(subscription.customData)
  const eventEnvironment = stringValue(customData.saas_core_billing_environment)
  if (eventEnvironment && eventEnvironment !== environment) throw new BillingSyncError("ENVIRONMENT_MISMATCH", "Paddle subscription belongs to another billing environment.")
  const providerPriceId = subscription.items[0]?.priceId || null
  const mapping = await getSubscriptionPlanFromPrice(providerPriceId, environment)
  if (!mapping || !isPaidPlanKey(mapping.plan_key)) throw new BillingSyncError("UNKNOWN_PRICE", "Paddle subscription price is not registered for this environment.")
  if (!isBillingEnvironmentMatch(environment, mapping.environment)) throw new BillingSyncError("ENVIRONMENT_MISMATCH", "Paddle price mapping belongs to another billing environment.")
  const providerProductId = subscription.items[0]?.productId
  if (providerProductId && providerProductId !== mapping.provider_product_id) throw new BillingSyncError("UNKNOWN_PRODUCT", "Paddle subscription product does not match its registered price.")

  const supabase = createServiceRoleClient()
  const existingByProvider = await supabase.from("workspace_subscriptions").select("workspace_id, plan_key, status, source, provider, provider_environment, provider_subscription_id, provider_status, billing_interval, billing_currency, current_period_start, current_period_end, current_period_start_at, current_period_end_at, scheduled_plan_key, scheduled_plan_at, scheduled_effective_at, scheduled_plan_interval, scheduled_provider_price_id, last_provider_event_at, last_provider_event_id, payment_failure_started_at, payment_grace_ends_at, billing_issue_code").eq("provider", BILLING_PROVIDER).eq("provider_environment", environment).eq("provider_subscription_id", subscription.id).maybeSingle()
  if (existingByProvider.error) throw new Error(existingByProvider.error.message)
  const workspaceId = existingByProvider.data?.workspace_id || getWorkspaceIdFromEvent(event)
  if (!workspaceId) throw new BillingSyncError("UNKNOWN_WORKSPACE", "Paddle subscription is not linked to a workspace.")
  const current = await supabase.from("workspace_subscriptions").select("workspace_id, plan_key, status, source, provider, provider_environment, provider_subscription_id, provider_status, billing_interval, billing_currency, current_period_start, current_period_end, current_period_start_at, current_period_end_at, scheduled_plan_key, scheduled_plan_at, scheduled_effective_at, scheduled_plan_interval, scheduled_provider_price_id, last_provider_event_at, last_provider_event_id, payment_failure_started_at, payment_grace_ends_at, billing_issue_code").eq("workspace_id", workspaceId).maybeSingle()
  if (current.error) throw new Error(current.error.message)
  if (!current.data) throw new BillingSyncError("UNKNOWN_WORKSPACE", "Workspace subscription does not exist.")
  if (current.data.provider && current.data.provider !== BILLING_PROVIDER) throw new BillingSyncError("PROVIDER_MISMATCH", "Workspace uses another billing provider.")
  if (current.data.provider_environment && current.data.provider_environment !== environment && current.data.provider_subscription_id) throw new BillingSyncError("ENVIRONMENT_MISMATCH", "Workspace subscription belongs to another billing environment.")
  const replacingCanceled = isTerminalBillingSubscription(current.data.provider_status || current.data.status) && current.data.provider_subscription_id !== subscription.id
  if (current.data.provider_subscription_id && current.data.provider_subscription_id !== subscription.id && !replacingCanceled) throw new BillingSyncError("DUPLICATE_PROVIDER_SUBSCRIPTION", "Workspace already has another Paddle subscription.")
  if (!existingByProvider.data && current.data.source !== "system" && current.data.source !== "paddle" && !replacingCanceled) throw new BillingSyncError("WORKSPACE_NOT_BILLING_ELIGIBLE", "Workspace already has a non-Paddle commercial state.")
  const fallbackPlanKey = await getConfiguredFallbackPlanKey(supabase)
  const projection = projectCanonicalSubscription({ eventId: event.eventId, occurredAt: event.occurredAt, subscription, mapping, fallbackPlanKey, current: current.data, now: new Date() })
  if (!projection.applied) return { status: "ignored" as const, reason: projection.reason || "OUT_OF_ORDER", workspaceId }
  const scheduledChange = subscription.scheduledChange
  let updateQuery = supabase.from("workspace_subscriptions").update({ plan_key: projection.planKey, status: subscription.status, source: "paddle", provider: BILLING_PROVIDER, provider_environment: environment, provider_customer_id: subscription.customerId, provider_subscription_id: subscription.id, provider_price_id: providerPriceId, billing_interval: projection.billingInterval, billing_currency: projection.billingCurrency, provider_status: subscription.status, current_period_start: projection.currentPeriodStart, current_period_end: projection.currentPeriodEnd, current_period_start_at: projection.currentPeriodStartAt, current_period_end_at: projection.currentPeriodEndAt, cancel_at_period_end: scheduledChange?.action === "cancel", last_provider_event_at: event.occurredAt, last_provider_event_id: event.eventId, next_billed_at: subscription.nextBilledAt, scheduled_change_at: scheduledChange?.effectiveAt || null, scheduled_change_action: scheduledChange?.action || null, scheduled_plan_key: projection.scheduledPlanKey, scheduled_plan_at: projection.scheduledPlanAt, scheduled_effective_at: projection.scheduledEffectiveAt, scheduled_plan_interval: projection.scheduledPlanInterval, scheduled_provider_price_id: projection.scheduledProviderPriceId, payment_failure_started_at: projection.paymentFailureStartedAt, payment_grace_ends_at: projection.paymentGraceEndsAt, billing_issue_code: projection.billingIssueCode }).eq("workspace_id", workspaceId)
  if (replacingCanceled) updateQuery = updateQuery.eq("provider_status", "canceled")
  else if (!current.data.last_provider_event_at) updateQuery = updateQuery.is("last_provider_event_at", null)
  else if (compareBillingEventOrder(event.occurredAt, event.eventId, current.data.last_provider_event_at, current.data.last_provider_event_id) === "newer") updateQuery = updateQuery.or(`last_provider_event_at.lt.${event.occurredAt},and(last_provider_event_at.eq.${event.occurredAt},last_provider_event_id.lt.${event.eventId})`)
  else return { status: "ignored" as const, reason: "OUT_OF_ORDER" as const, workspaceId }
  const { data: updated, error: updateError } = await updateQuery.select("workspace_id").maybeSingle()
  if (updateError) throw new Error(updateError.message)
  if (!updated) return { status: "ignored" as const, reason: "OUT_OF_ORDER" as const, workspaceId }
  if (subscription.customerId) await upsertBillingProviderAccount({ workspaceId, provider: BILLING_PROVIDER, environment, providerAccountId: subscription.customerId, providerCustomerId: subscription.customerId, metadata: { subscriptionId: subscription.id } })
  return { status: "processed" as const, workspaceId, planKey: projection.planKey }
}

export const applyPaddleEvent = applyPaddleSubscriptionEvent

export async function recordPaddleWebhookEvent(event: NormalizedPaddleEvent) {
  const environment = getBillingEnvironment()
  const db = createServiceRoleClient()
  const existing = await db.from("billing_webhook_events").select("id, status").eq("provider", BILLING_PROVIDER).eq("environment", environment).eq("provider_event_id", event.eventId).maybeSingle()
  if (existing.error) throw new Error(existing.error.message)
  const stored = await recordBillingWebhookEvent({ provider: BILLING_PROVIDER, environment, providerEventId: event.eventId, eventType: event.eventType, occurredAt: event.occurredAt, providerObjectId: getSubscriptionObjectId(event), workspaceId: getWorkspaceIdFromEvent(event), payload: { eventId: event.eventId, eventType: event.eventType, occurredAt: event.occurredAt, data: event.data } }, db as any)
  return { id: stored.id, duplicate: Boolean(existing.data), status: stored.status, nextAttemptAt: stored.next_attempt_at, environment }
}

function retryAt(attempts: number, now: Date) {
  const seconds = Math.min(3600, 30 * 2 ** Math.max(0, attempts - 1))
  return new Date(now.getTime() + seconds * 1000).toISOString()
}

export async function processStoredPaddleWebhookEvent(eventId: string) {
  const db = createServiceRoleClient()
  const loaded = await db.from("billing_webhook_events").select("id, status, attempts, next_attempt_at").eq("id", eventId).single()
  if (loaded.error || !loaded.data) throw new Error(loaded.error?.message || "Paddle webhook event not found.")
  if (loaded.data.status === "processed" || loaded.data.status === "ignored") return loaded.data.status
  const now = new Date()
  const leaseToken = randomUUID()
  const claim = await claimBillingWebhookEvent({ eventId, leaseToken, leaseSeconds: 300, allowReclaim: true, now }, db as any)
  if (!claim.claimed) return claim.status === "not_found" ? "failed" as const : claim.status as "received" | "processing" | "failed" | "processed" | "ignored"
  try {
    const payload = asRecord(claim.payload)
    const result = await applyPaddleSubscriptionEvent({ eventId: stringValue(payload.eventId) || "", eventType: stringValue(payload.eventType) || "", occurredAt: stringValue(payload.occurredAt) || "", data: asRecord(payload.data) })
    await finalizeBillingWebhookEvent({ eventId, leaseToken, status: result.status, errorCode: result.status === "ignored" ? result.reason : null, now }, db as any)
    return result.status
  } catch (error) {
    const code = error instanceof BillingSyncError ? error.code : "PROCESSING_FAILED"
    const message = error instanceof Error ? error.message : "Paddle webhook processing failed."
    const nextAttemptAt = claim.attempts < claim.max_attempts ? retryAt(claim.attempts, now) : null
    try { await finalizeBillingWebhookEvent({ eventId, leaseToken, status: "failed", errorCode: code, errorMessage: message.slice(0, 2000), nextAttemptAt, now }, db as any) } catch (finalizeError) { console.error("Could not finalize Paddle webhook failure", { eventId, message: finalizeError instanceof Error ? finalizeError.message : String(finalizeError) }) }
    console.error("Paddle webhook processing failed", { eventId, code, message })
    return "failed" as const
  }
}
