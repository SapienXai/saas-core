import "server-only"

import { createServiceRoleClient } from "@/lib/supabase"
import { getConfiguredFallbackPlanKey } from "./reconciliation"
import { finalizeBillingWebhookEvent } from "./persistence"
import { processStoredStripeWebhookEvent } from "./stripe-webhook"

export const PAYMENT_GRACE_PERIOD_DAYS = 14
export const STRIPE_WEBHOOK_DRAIN_BATCH_SIZE = 4

export function getStripeWebhookDrainBatchLimit(requested = STRIPE_WEBHOOK_DRAIN_BATCH_SIZE) {
  if (!Number.isFinite(requested)) return STRIPE_WEBHOOK_DRAIN_BATCH_SIZE
  return Math.min(STRIPE_WEBHOOK_DRAIN_BATCH_SIZE, Math.max(1, Math.trunc(requested)))
}

export function selectStripeWebhookDrainCandidates<
  T extends { id: string; attempts: number; max_attempts: number; received_at: string },
>(waiting: T[], expiredLeases: T[], limit = STRIPE_WEBHOOK_DRAIN_BATCH_SIZE) {
  return [...waiting, ...expiredLeases]
    .filter((row) => Number(row.attempts) < Number(row.max_attempts))
    .sort((left, right) => left.received_at.localeCompare(right.received_at))
    .slice(0, getStripeWebhookDrainBatchLimit(limit))
}

export function getPaymentGraceEndsAt(startedAt: string, days = PAYMENT_GRACE_PERIOD_DAYS) {
  const start = new Date(startedAt)
  if (!Number.isFinite(start.getTime()) || !Number.isSafeInteger(days) || days < 0) return null
  return new Date(start.getTime() + days * 24 * 60 * 60 * 1000).toISOString()
}

export function isPaymentGraceExpired(graceEndsAt: string | null | undefined, now = new Date()) {
  if (!graceEndsAt) return false
  const end = new Date(graceEndsAt)
  return Number.isFinite(end.getTime()) && end.getTime() <= now.getTime()
}

export function isExhaustedWebhookLease(
  row: { attempts: number; max_attempts: number; lease_until: string | null },
  now = new Date(),
) {
  const leaseUntil = row.lease_until ? new Date(row.lease_until) : null
  return Number(row.attempts) >= Number(row.max_attempts) && Boolean(leaseUntil && Number.isFinite(leaseUntil.getTime()) && leaseUntil <= now)
}

export async function expirePaymentGracePeriods(now = new Date()) {
  const supabase = createServiceRoleClient()
  const fallbackPlanKey = await getConfiguredFallbackPlanKey(supabase)
  const { data, error } = await supabase
    .from("workspace_subscriptions")
    .update({
      plan_key: fallbackPlanKey,
      billing_issue_code: "grace_expired",
      scheduled_plan_key: null,
      scheduled_plan_at: null,
      scheduled_effective_at: null,
      scheduled_plan_interval: null,
      scheduled_provider_price_id: null,
    })
    .neq("plan_key", fallbackPlanKey)
    .eq("provider_status", "past_due")
    .not("payment_grace_ends_at", "is", null)
    .lte("payment_grace_ends_at", now.toISOString())
    .select("workspace_id")

  if (error) throw new Error(error.message)
  return {
    expiredCount: data?.length || 0,
    workspaceIds: (data || []).map((row) => row.workspace_id),
  }
}

/** Drain durable Stripe webhook receipts after an interrupted after() task. */
export async function processDueStripeBillingWebhookEvents(limit = 50, now = new Date()) {
  const db = createServiceRoleClient() as any
  const batchLimit = getStripeWebhookDrainBatchLimit(limit)
  const nowIso = now.toISOString()
  const [waiting, expiredLeases] = await Promise.all([
    db.from("billing_webhook_events")
      .select("id, attempts, max_attempts, received_at")
      .eq("provider", "stripe")
      .in("status", ["received", "failed"])
      .or("next_attempt_at.is.null,next_attempt_at.lte." + nowIso)
      .order("received_at", { ascending: true })
      .limit(batchLimit),
    db.from("billing_webhook_events")
      .select("id, attempts, max_attempts, lease_token, lease_until, received_at")
      .eq("provider", "stripe")
      .eq("status", "processing")
      .lte("lease_until", nowIso)
      .order("received_at", { ascending: true })
      .limit(batchLimit),
  ])
  if (waiting.error || expiredLeases.error) throw new Error(waiting.error?.message || expiredLeases.error?.message)
  let exhausted = 0
  for (const row of expiredLeases.data || []) {
    if (!isExhaustedWebhookLease(row, now) || typeof row.lease_token !== "string") continue
    const finalized = await finalizeBillingWebhookEvent({
      eventId: row.id,
      leaseToken: row.lease_token,
      status: "failed",
      errorCode: "MAX_ATTEMPTS_EXCEEDED",
      errorMessage: "The processing lease expired after all webhook attempts were used.",
      now,
    }, db)
    if (finalized.updated) exhausted += 1
  }
  const candidates = selectStripeWebhookDrainCandidates(
    waiting.data || [],
    expiredLeases.data || [],
    batchLimit,
  )
  const results: Array<{ id: string; status: string }> = []
  for (const row of candidates) {
    const status = await processStoredStripeWebhookEvent(row.id)
    results.push({ id: row.id, status })
  }
  return {
    attempted: results.length,
    processed: results.filter((row) => row.status === "processed").length,
    failed: results.filter((row) => row.status === "failed").length,
    skipped: results.filter((row) => row.status !== "processed" && row.status !== "failed").length,
    exhausted,
  }
}
