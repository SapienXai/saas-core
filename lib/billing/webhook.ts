import "server-only"

import type { Json } from "@/types/supabase"
import { createServiceRoleClient } from "@/lib/supabase"
import { getPaddlePriceByProviderId, isPaidPlanKey, type PaidPlanKey } from "./price-mapping"
import { getBillingEnvironment } from "./paddle-client"
import { getPaymentGraceEndsAt, isPaymentGraceExpired } from "./lifecycle"

export type PaddleSubscriptionStatus = "active" | "trialing" | "past_due" | "paused" | "canceled"

export type NormalizedPaddleSubscription = {
  id: string
  status: PaddleSubscriptionStatus
  customerId: string | null
  nextBilledAt: string | null
  currentBillingPeriod: { startsAt: string; endsAt: string } | null
  scheduledChange: { action: "cancel" | "pause" | "resume"; effectiveAt: string; resumeAt: string | null } | null
  customData: Record<string, unknown> | null
  items: Array<{ priceId: string | null; quantity: number }>
}

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


function normalizeCustomData(value: unknown): Record<string, unknown> | null {
  const data = asRecord(value)
  return Object.keys(data).length ? data : null
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
      ? {
          startsAt: stringValue(period.startsAt || period.starts_at) as string,
          endsAt: stringValue(period.endsAt || period.ends_at) as string,
        }
      : null,
    scheduledChange: scheduledAction && stringValue(scheduled.effectiveAt || scheduled.effective_at)
      ? {
          action: scheduledAction as "cancel" | "pause" | "resume",
          effectiveAt: stringValue(scheduled.effectiveAt || scheduled.effective_at) as string,
          resumeAt: stringValue(scheduled.resumeAt || scheduled.resume_at),
        }
      : null,
    customData: normalizeCustomData(data.customData || data.custom_data),
    items: items.map((item) => {
      const itemData = asRecord(item)
      const price = asRecord(itemData.price)
      return {
        priceId: stringValue(itemData.priceId || itemData.price_id || price.id),
        quantity: typeof itemData.quantity === "number" ? itemData.quantity : 1,
      }
    }),
  }
}

export function normalizePaddleEvent(event: { eventId?: string; event_id?: string; eventType?: string; event_type?: string; occurredAt?: string; occurred_at?: string; data?: unknown }): NormalizedPaddleEvent {
  const eventId = stringValue(event.eventId || event.event_id)
  const eventType = stringValue(event.eventType || event.event_type)
  const occurredAt = stringValue(event.occurredAt || event.occurred_at)
  if (!eventId || !eventType || !occurredAt) {
    throw new BillingSyncError("INVALID_EVENT", "Paddle webhook event metadata is incomplete.")
  }

  return {
    eventId,
    eventType,
    occurredAt,
    data: asRecord(event.data),
  }
}

export function getSubscriptionObjectId(event: NormalizedPaddleEvent) {
  return stringValue(event.data.id)
}

async function applyPaddleTransactionEvent(event: NormalizedPaddleEvent) {
  const transactionId = stringValue(event.data.id)
  if (!transactionId) throw new BillingSyncError("INVALID_TRANSACTION", "Paddle transaction ID is missing.")
  const customData = asRecord(event.data.customData || event.data.custom_data)
  const workspaceId = stringValue(customData.reservevia_workspace_id)
  const supabase = createServiceRoleClient()
  let query = supabase.from("billing_checkout_sessions").update({ status: event.eventType === "transaction.completed" || event.eventType === "transaction.paid" || event.eventType === "transaction.billed" ? "completed" : event.eventType === "transaction.payment_failed" || event.eventType === "transaction.canceled" ? "failed" : "created" }).eq("provider", "paddle").eq("provider_transaction_id", transactionId)
  if (workspaceId) query = query.eq("workspace_id", workspaceId)
  const { data, error } = await query.select("workspace_id").maybeSingle()
  if (error) throw new Error(error.message)
  return { status: data ? "processed" as const : "ignored" as const, reason: data ? undefined : "UNKNOWN_CHECKOUT" as const, workspaceId: data?.workspace_id || workspaceId || undefined }
}

export function getWorkspaceIdFromEvent(event: NormalizedPaddleEvent) {
  const customData = asRecord(event.data.customData || event.data.custom_data)
  return stringValue(customData.reservevia_workspace_id)
}

export function getSubscriptionPlanForStatus(status: PaddleSubscriptionStatus, purchasedPlan: PaidPlanKey): PaidPlanKey | "free" {
  return status === "paused" || status === "canceled" ? "free" : purchasedPlan
}

export function getSubscriptionPlanFromPrice(providerPriceId: string | null, environment = getBillingEnvironment()) {
  if (!providerPriceId) return Promise.resolve(null)
  // Existing subscribers can still be on a retired price. A registered price
  // remains authoritative for synchronization even after it stops being sold.
  return getPaddlePriceByProviderId(providerPriceId, environment, false)
}

function calendarPeriod() {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

function dateOnly(value: string | null) {
  return value ? value.slice(0, 10) : null
}

function subscriptionPeriod(
  subscription: NormalizedPaddleSubscription,
  existingPeriod: { start: string | null; end: string | null } | null,
  occurredAt: string,
) {
  const paddleStart = dateOnly(subscription.currentBillingPeriod?.startsAt || null)
  const paddleEnd = dateOnly(subscription.currentBillingPeriod?.endsAt || null)
  if (paddleStart && paddleEnd) return { start: paddleStart, end: paddleEnd }
  if (existingPeriod?.start && existingPeriod.end) return existingPeriod

  const eventStart = dateOnly(occurredAt)
  const nextBillingEnd = dateOnly(subscription.nextBilledAt)
  if (eventStart && nextBillingEnd) return { start: eventStart, end: nextBillingEnd }
  return calendarPeriod()
}

export async function applyPaddleSubscriptionEvent(event: NormalizedPaddleEvent) {
  if (event.eventType.startsWith("transaction.")) return applyPaddleTransactionEvent(event)
  if (!event.eventType.startsWith("subscription.")) {
    return { status: "ignored" as const, reason: "UNSUPPORTED_EVENT" }
  }

  const subscription = normalizeSubscriptionData(event.data)
  if (!subscription.id) throw new BillingSyncError("INVALID_SUBSCRIPTION", "Paddle subscription ID is missing.")

  const environment = getBillingEnvironment()
  const eventEnvironment = stringValue(asRecord(subscription.customData).reservevia_billing_environment)
  if (eventEnvironment && eventEnvironment !== environment) {
    throw new BillingSyncError("ENVIRONMENT_MISMATCH", "Paddle subscription belongs to another billing environment.")
  }
  const providerPriceId = subscription.items[0]?.priceId || null
  const mapping = await getSubscriptionPlanFromPrice(providerPriceId, environment)
  if (!mapping || !isPaidPlanKey(mapping.plan_key)) {
    throw new BillingSyncError("UNKNOWN_PRICE", "Paddle subscription price is not registered for this environment.")
  }

  const supabase = createServiceRoleClient()
  const existingByProvider = await supabase
    .from("workspace_subscriptions")
    .select("workspace_id, plan_key, source, provider, provider_environment, provider_subscription_id, provider_status, billing_interval, billing_currency, current_period_start, current_period_end, current_period_start_at, current_period_end_at, scheduled_plan_key, scheduled_plan_at, scheduled_effective_at, scheduled_plan_interval, scheduled_provider_price_id, last_provider_event_at, payment_failure_started_at, payment_grace_ends_at, billing_issue_code")
    .eq("provider", "paddle")
    .eq("provider_environment", environment)
    .eq("provider_subscription_id", subscription.id)
    .maybeSingle()
  if (existingByProvider.error) throw new Error(existingByProvider.error.message)

  const workspaceId = existingByProvider.data?.workspace_id || getWorkspaceIdFromEvent(event)
  if (!workspaceId) throw new BillingSyncError("UNKNOWN_WORKSPACE", "Paddle subscription is not linked to a Reservevia workspace.")

  const current = await supabase
    .from("workspace_subscriptions")
    .select("workspace_id, plan_key, source, provider, provider_environment, provider_subscription_id, provider_status, billing_interval, billing_currency, current_period_start, current_period_end, current_period_start_at, current_period_end_at, scheduled_plan_key, scheduled_plan_at, scheduled_effective_at, scheduled_plan_interval, scheduled_provider_price_id, last_provider_event_at, payment_failure_started_at, payment_grace_ends_at, billing_issue_code")
    .eq("workspace_id", workspaceId)
    .maybeSingle()
  if (current.error) throw new Error(current.error.message)
  if (!current.data) throw new BillingSyncError("UNKNOWN_WORKSPACE", "Reservevia workspace subscription does not exist.")

  const canReplaceCanceledSubscription = current.data.plan_key === "free" && current.data.provider_status === "canceled"
  if (current.data.provider_subscription_id && current.data.provider_subscription_id !== subscription.id && !canReplaceCanceledSubscription) {
    throw new BillingSyncError("DUPLICATE_PROVIDER_SUBSCRIPTION", "Workspace already has another Paddle subscription.")
  }

  if (!existingByProvider.data && current.data.plan_key !== "free" && current.data.source !== "paddle") {
    throw new BillingSyncError("WORKSPACE_NOT_BILLING_ELIGIBLE", "Workspace already has a non-Paddle commercial state.")
  }

  if (current.data.last_provider_event_at && event.occurredAt <= current.data.last_provider_event_at) {
    return { status: "ignored" as const, reason: "OUT_OF_ORDER", workspaceId }
  }

  const effectivePlan = getSubscriptionPlanForStatus(subscription.status, mapping.plan_key)
  const paymentFailureStartedAt = subscription.status === "past_due"
    ? current.data.payment_failure_started_at || event.occurredAt
    : null
  const paymentGraceEndsAt = paymentFailureStartedAt
    ? current.data.payment_grace_ends_at || getPaymentGraceEndsAt(paymentFailureStartedAt)
    : null
  const graceExpired = subscription.status === "past_due" && isPaymentGraceExpired(paymentGraceEndsAt)
  const pendingPlanIsActive = subscription.status !== "paused" && subscription.status !== "canceled" &&
    (current.data.scheduled_plan_key === mapping.plan_key || current.data.plan_key === mapping.plan_key) &&
    Boolean((current.data.scheduled_effective_at || current.data.scheduled_plan_at) && (current.data.scheduled_effective_at || current.data.scheduled_plan_at) > new Date().toISOString())
  const localPlan = graceExpired ? "free" : pendingPlanIsActive ? current.data.plan_key : effectivePlan
  const localBillingInterval = pendingPlanIsActive && current.data.billing_interval ? current.data.billing_interval : mapping.billing_interval
  const localBillingCurrency = pendingPlanIsActive && current.data.billing_currency ? current.data.billing_currency : mapping.currency
  const period = subscriptionPeriod(
    subscription,
    current.data.provider === "paddle" && current.data.provider_subscription_id === subscription.id && current.data.current_period_start && current.data.current_period_end
      ? { start: current.data.current_period_start, end: current.data.current_period_end }
      : null,
    event.occurredAt,
  )
  const scheduledCancel = subscription.scheduledChange?.action === "cancel"

  const updateQuery = supabase
    .from("workspace_subscriptions")
    .update({
      plan_key: localPlan,
      status: subscription.status,
      source: "paddle",
      provider: "paddle",
      provider_environment: environment,
      provider_customer_id: subscription.customerId,
      provider_subscription_id: subscription.id,
      provider_price_id: providerPriceId,
      billing_interval: localBillingInterval,
      billing_currency: localBillingCurrency,
      provider_status: subscription.status,
      current_period_start: period.start,
      current_period_end: period.end,
      current_period_start_at: subscription.currentBillingPeriod?.startsAt || null,
      current_period_end_at: subscription.currentBillingPeriod?.endsAt || null,
      cancel_at_period_end: scheduledCancel,
      last_provider_event_at: event.occurredAt,
      last_provider_event_id: event.eventId,
      next_billed_at: subscription.nextBilledAt,
      scheduled_change_at: subscription.scheduledChange?.effectiveAt || null,
      scheduled_change_action: subscription.scheduledChange?.action || null,
      scheduled_plan_key: pendingPlanIsActive ? current.data.scheduled_plan_key : null,
      scheduled_plan_at: pendingPlanIsActive ? current.data.scheduled_plan_at : null,
      scheduled_effective_at: pendingPlanIsActive ? current.data.scheduled_effective_at : null,
      scheduled_plan_interval: pendingPlanIsActive ? current.data.scheduled_plan_interval : null,
      scheduled_provider_price_id: pendingPlanIsActive ? current.data.scheduled_provider_price_id : null,
      payment_failure_started_at: paymentFailureStartedAt,
      payment_grace_ends_at: paymentGraceEndsAt,
      billing_issue_code: subscription.status === "past_due" ? (graceExpired ? "grace_expired" : "past_due") : null,
    })
    .eq("workspace_id", workspaceId)
  const orderedUpdate = current.data.last_provider_event_at
    ? updateQuery.lt("last_provider_event_at", event.occurredAt)
    : updateQuery.is("last_provider_event_at", null)
  const { data: updated, error: updateError } = await orderedUpdate.select("workspace_id").maybeSingle()

  if (updateError) throw new Error(updateError.message)
  if (!updated) return { status: "ignored" as const, reason: "OUT_OF_ORDER", workspaceId }

  return { status: "processed" as const, workspaceId, planKey: localPlan }
}

export async function recordPaddleWebhookEvent(event: NormalizedPaddleEvent) {
  const supabase = createServiceRoleClient()
  const payload = {
    eventId: event.eventId,
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    data: event.data,
  } as unknown as Json
  const workspaceId = getWorkspaceIdFromEvent(event)
  const providerObjectId = getSubscriptionObjectId(event)

  const { data: inserted, error } = await supabase
    .from("billing_webhook_events")
    .insert({
      provider: "paddle",
      provider_event_id: event.eventId,
      event_type: event.eventType,
      occurred_at: event.occurredAt,
      provider_object_id: providerObjectId,
      workspace_id: workspaceId,
      status: "received",
      payload,
    })
    .select("id, status, attempts")
    .maybeSingle()

  if (!error && inserted) return { id: inserted.id, duplicate: false, status: inserted.status }
  if (error?.code !== "23505") throw new Error(error?.message || "Could not store Paddle webhook event.")

  const { data: existing, error: lookupError } = await supabase
    .from("billing_webhook_events")
    .select("id, status, attempts")
    .eq("provider", "paddle")
    .eq("provider_event_id", event.eventId)
    .single()
  if (lookupError || !existing) throw new Error(lookupError?.message || "Could not load duplicate Paddle webhook event.")

  if (existing.status === "failed") {
    await supabase
      .from("billing_webhook_events")
      .update({ status: "received", processing_started_at: null, error_code: null, error_message: null })
      .eq("id", existing.id)
    return { id: existing.id, duplicate: false, status: "received" }
  }

  return { id: existing.id, duplicate: true, status: existing.status }
}

export async function processStoredPaddleWebhookEvent(eventId: string) {
  const supabase = createServiceRoleClient()
  const { data: stored, error: loadError } = await supabase
    .from("billing_webhook_events")
    .select("id, status, attempts, processing_started_at, payload")
    .eq("id", eventId)
    .single()
  if (loadError || !stored) throw new Error(loadError?.message || "Paddle webhook event not found.")
  if (stored.status === "processed" || stored.status === "ignored") return stored.status

  const staleProcessing = stored.status === "processing" && (!stored.processing_started_at || Date.now() - new Date(stored.processing_started_at).getTime() > 5 * 60 * 1000)
  if (stored.status === "processing" && !staleProcessing) return "processing" as const

  let claimQuery = supabase
    .from("billing_webhook_events")
    .update({ status: "processing", attempts: stored.attempts + 1, processing_started_at: new Date().toISOString(), error_code: null, error_message: null })
    .eq("id", eventId)
  claimQuery = stored.status === "processing"
    ? claimQuery.eq("status", "processing")
    : claimQuery.in("status", ["received", "failed"])
  const { data: claimed, error: claimError } = await claimQuery.select("id").maybeSingle()
  if (claimError) throw new Error(claimError.message)
  if (!claimed) return "processing" as const

  try {
    const payload = asRecord(stored.payload)
    const result = await applyPaddleSubscriptionEvent({
      eventId: stringValue(payload.eventId) || "",
      eventType: stringValue(payload.eventType) || "",
      occurredAt: stringValue(payload.occurredAt) || "",
      data: asRecord(payload.data),
    })
    await supabase
      .from("billing_webhook_events")
      .update({
        status: result.status,
        processing_started_at: null,
        workspace_id: "workspaceId" in result ? result.workspaceId : undefined,
        error_code: result.status === "ignored" ? result.reason : null,
        error_message: null,
        processed_at: new Date().toISOString(),
      })
      .eq("id", eventId)
    return result.status
  } catch (error) {
    const code = error instanceof BillingSyncError ? error.code : "PROCESSING_FAILED"
    const message = error instanceof Error ? error.message : "Paddle webhook processing failed."
    console.error("Paddle webhook processing failed", { eventId, code, message })
    await supabase
      .from("billing_webhook_events")
      .update({ status: "failed", processing_started_at: null, error_code: code, error_message: message.slice(0, 240) })
      .eq("id", eventId)
    return "failed" as const
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}
