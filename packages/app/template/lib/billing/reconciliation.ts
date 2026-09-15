import "server-only"

import type { ProviderPriceMapping } from "./price-mapping"
import { createServiceRoleClient } from "@/lib/supabase"

export const BILLING_PROVIDER = "paddle"

export function isBillingEnvironmentMatch(expected: "sandbox" | "live", observed: unknown) {
  return observed === expected
}

function getPaymentGraceEndsAt(startedAt: string, days = 14) {
  const start = new Date(startedAt)
  if (!Number.isFinite(start.getTime())) return null
  return new Date(start.getTime() + days * 24 * 60 * 60 * 1000).toISOString()
}

function isPaymentGraceExpired(graceEndsAt: string | null | undefined, now: Date) {
  if (!graceEndsAt) return false
  const end = new Date(graceEndsAt)
  return Number.isFinite(end.getTime()) && end.getTime() <= now.getTime()
}

export type BillingEventOrder = "newer" | "same" | "older"

/**
 * Provider timestamps are authoritative. Event IDs are used only as a stable
 * tie breaker when a provider emits two events at exactly the same instant.
 */
export function compareBillingEventOrder(
  incomingOccurredAt: string,
  incomingEventId: string,
  currentOccurredAt: string | null | undefined,
  currentEventId: string | null | undefined,
): BillingEventOrder {
  if (!currentOccurredAt) return "newer"
  const incoming = new Date(incomingOccurredAt).getTime()
  const current = new Date(currentOccurredAt).getTime()
  if (!Number.isFinite(incoming) || !Number.isFinite(current)) return "older"
  if (incoming > current) return "newer"
  if (incoming < current) return "older"
  if (!currentEventId) return "newer"
  if (incomingEventId === currentEventId) return "same"
  return incomingEventId > currentEventId ? "newer" : "older"
}

export function isTerminalBillingSubscription(status: string | null | undefined) {
  return status === "canceled"
}

export type BillingSubscriptionProjectionRow = {
  provider?: string | null
  provider_environment?: string | null
  provider_subscription_id?: string | null
  provider_status?: string | null
  status?: string | null
  source?: string | null
  plan_key: string
  billing_interval?: string | null
  billing_currency?: string | null
  current_period_start?: string | null
  current_period_end?: string | null
  current_period_start_at?: string | null
  current_period_end_at?: string | null
  scheduled_plan_key?: string | null
  scheduled_plan_at?: string | null
  scheduled_effective_at?: string | null
  scheduled_plan_interval?: string | null
  scheduled_provider_price_id?: string | null
  last_provider_event_at?: string | null
  last_provider_event_id?: string | null
  billing_issue_code?: string | null
  payment_failure_started_at?: string | null
  payment_grace_ends_at?: string | null
}

export type CanonicalSubscription = {
  id: string
  status: "active" | "trialing" | "past_due" | "paused" | "canceled"
  customerId: string | null
  nextBilledAt: string | null
  currentBillingPeriod: { startsAt: string; endsAt: string } | null
  scheduledChange: { action: "cancel" | "pause" | "resume"; effectiveAt: string; resumeAt: string | null } | null
  customData: Record<string, unknown> | null
  items: Array<{ priceId: string | null; productId?: string | null; quantity: number }>
}

export type SubscriptionProjectionResult = {
  applied: boolean
  reason?: "OUT_OF_ORDER" | "DUPLICATE"
  planKey: string
  status: CanonicalSubscription["status"]
  billingInterval: string
  billingCurrency: string
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  currentPeriodStartAt: string | null
  currentPeriodEndAt: string | null
  paymentFailureStartedAt: string | null
  paymentGraceEndsAt: string | null
  billingIssueCode: string | null
  scheduledPlanKey: string | null
  scheduledPlanAt: string | null
  scheduledEffectiveAt: string | null
  scheduledPlanInterval: string | null
  scheduledProviderPriceId: string | null
}

function dateOnly(value: string | null | undefined) {
  return value ? value.slice(0, 10) : null
}

function periodFor(subscription: CanonicalSubscription, current: BillingSubscriptionProjectionRow, occurredAt: string) {
  const providerStart = dateOnly(subscription.currentBillingPeriod?.startsAt)
  const providerEnd = dateOnly(subscription.currentBillingPeriod?.endsAt)
  if (providerStart && providerEnd) return { start: providerStart, end: providerEnd }
  if (current.current_period_start && current.current_period_end) {
    return { start: current.current_period_start, end: current.current_period_end }
  }
  const eventStart = dateOnly(occurredAt)
  const nextBilledAt = dateOnly(subscription.nextBilledAt)
  if (eventStart && nextBilledAt) return { start: eventStart, end: nextBilledAt }
  return { start: null, end: null }
}

function currentScheduledAt(current: BillingSubscriptionProjectionRow) {
  return current.scheduled_effective_at || current.scheduled_plan_at || null
}

/**
 * Apply the same status, grace, and scheduled-plan policy to webhook and
 * reconciliation observations. This function is deliberately side-effect
 * free so fixtures can exercise it without Paddle or Supabase.
 */
export function projectCanonicalSubscription(input: {
  eventId: string
  occurredAt: string
  subscription: CanonicalSubscription
  mapping: ProviderPriceMapping
  fallbackPlanKey: string
  current: BillingSubscriptionProjectionRow
  now?: Date
}) : SubscriptionProjectionResult {
  const replacingTerminalSubscription = Boolean(
    input.current.provider_subscription_id &&
    input.current.provider_subscription_id !== input.subscription.id &&
    isTerminalBillingSubscription(input.current.provider_status || input.current.status),
  )
  if (!replacingTerminalSubscription) {
    const order = compareBillingEventOrder(
      input.occurredAt,
      input.eventId,
      input.current.last_provider_event_at,
      input.current.last_provider_event_id,
    )
    if (order === "same") {
      return {
        applied: false,
        reason: "DUPLICATE",
        planKey: input.current.plan_key,
        status: input.subscription.status,
        billingInterval: input.mapping.billing_interval,
        billingCurrency: input.mapping.currency,
        currentPeriodStart: input.current.current_period_start || null,
        currentPeriodEnd: input.current.current_period_end || null,
        currentPeriodStartAt: input.current.current_period_start_at || null,
        currentPeriodEndAt: input.current.current_period_end_at || null,
        paymentFailureStartedAt: input.current.payment_failure_started_at || null,
        paymentGraceEndsAt: input.current.payment_grace_ends_at || null,
        billingIssueCode: input.current.billing_issue_code || null,
        scheduledPlanKey: input.current.scheduled_plan_key || null,
        scheduledPlanAt: input.current.scheduled_plan_at || null,
        scheduledEffectiveAt: input.current.scheduled_effective_at || null,
        scheduledPlanInterval: input.current.scheduled_plan_interval || null,
        scheduledProviderPriceId: input.current.scheduled_provider_price_id || null,
      }
    }
    if (order === "older") {
      return {
        applied: false,
        reason: "OUT_OF_ORDER",
        planKey: input.current.plan_key,
        status: input.subscription.status,
        billingInterval: input.mapping.billing_interval,
        billingCurrency: input.mapping.currency,
        currentPeriodStart: input.current.current_period_start || null,
        currentPeriodEnd: input.current.current_period_end || null,
        currentPeriodStartAt: input.current.current_period_start_at || null,
        currentPeriodEndAt: input.current.current_period_end_at || null,
        paymentFailureStartedAt: input.current.payment_failure_started_at || null,
        paymentGraceEndsAt: input.current.payment_grace_ends_at || null,
        billingIssueCode: input.current.billing_issue_code || null,
        scheduledPlanKey: input.current.scheduled_plan_key || null,
        scheduledPlanAt: input.current.scheduled_plan_at || null,
        scheduledEffectiveAt: input.current.scheduled_effective_at || null,
        scheduledPlanInterval: input.current.scheduled_plan_interval || null,
        scheduledProviderPriceId: input.current.scheduled_provider_price_id || null,
      }
    }
  }

  const now = input.now || new Date()
  const paymentFailureStartedAt = input.subscription.status === "past_due"
    ? input.current.payment_failure_started_at || input.occurredAt
    : null
  const paymentGraceEndsAt = paymentFailureStartedAt
    ? input.current.payment_grace_ends_at || getPaymentGraceEndsAt(paymentFailureStartedAt)
    : null
  const graceExpired = input.subscription.status === "past_due" && isPaymentGraceExpired(paymentGraceEndsAt, now)
  const pendingPlanAt = currentScheduledAt(input.current)
  const pendingPlanIsFuture = Boolean(pendingPlanAt && new Date(pendingPlanAt).getTime() > now.getTime())
  const pendingPlanMatches = Boolean(
    pendingPlanIsFuture &&
    input.current.scheduled_plan_key === input.mapping.plan_key,
  )
  const planKey = graceExpired || input.subscription.status === "paused" || input.subscription.status === "canceled"
    ? input.fallbackPlanKey
    : pendingPlanMatches
      ? input.current.plan_key
      : input.mapping.plan_key
  const planChangeReachedBoundary = Boolean(
    input.current.scheduled_plan_key === input.mapping.plan_key &&
    pendingPlanAt &&
    new Date(pendingPlanAt).getTime() <= now.getTime(),
  )
  const keepScheduledPlan = pendingPlanMatches && !planChangeReachedBoundary && input.subscription.status !== "canceled" && input.subscription.status !== "paused"
  const period = periodFor(input.subscription, input.current, input.occurredAt)
  const issue = input.subscription.status === "past_due" ? (graceExpired ? "grace_expired" : "past_due") : null
  return {
    applied: true,
    planKey,
    status: input.subscription.status,
    billingInterval: keepScheduledPlan && input.current.billing_interval ? input.current.billing_interval : input.mapping.billing_interval,
    billingCurrency: keepScheduledPlan && input.current.billing_currency ? input.current.billing_currency : input.mapping.currency,
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
    currentPeriodStartAt: input.subscription.currentBillingPeriod?.startsAt || input.current.current_period_start_at || null,
    currentPeriodEndAt: input.subscription.currentBillingPeriod?.endsAt || input.current.current_period_end_at || null,
    paymentFailureStartedAt,
    paymentGraceEndsAt,
    billingIssueCode: issue,
    scheduledPlanKey: keepScheduledPlan ? input.current.scheduled_plan_key || null : null,
    scheduledPlanAt: keepScheduledPlan ? input.current.scheduled_plan_at || null : null,
    scheduledEffectiveAt: keepScheduledPlan ? input.current.scheduled_effective_at || null : null,
    scheduledPlanInterval: keepScheduledPlan ? input.current.scheduled_plan_interval || null : null,
    scheduledProviderPriceId: keepScheduledPlan ? input.current.scheduled_provider_price_id || null : null,
  }
}

type BillingDb = ReturnType<typeof createServiceRoleClient>

function scalarPlanKey(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (Array.isArray(value)) return scalarPlanKey(value[0])
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    return scalarPlanKey(record.core_default_plan_key || record.default_plan_key || record.key)
  }
  return null
}

/** Resolve the server-controlled Core fallback; never infer it from sort order. */
export async function getConfiguredDefaultPlanKey(client?: BillingDb): Promise<string> {
  const db = client || createServiceRoleClient()
  for (const functionName of ["get_core_default_plan_key", "core_default_plan_key"]) {
    try {
      const rpc = await (db as any).rpc(functionName)
      const candidate = scalarPlanKey(rpc.data)
      if (candidate && !rpc.error) {
        const { data, error } = await (db as any).from("plans").select("key").eq("key", candidate).eq("active", true).maybeSingle()
        if (!error && data?.key) return String(data.key)
      }
    } catch {
      // Older deployments may not expose this server-only helper.
    }
  }
  throw new Error("The configured fallback plan could not be verified.")
}

export const getConfiguredFallbackPlanKey = getConfiguredDefaultPlanKey
