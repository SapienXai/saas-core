import "server-only"

import { createServiceRoleClient } from "@/lib/supabase"

export const PAYMENT_GRACE_PERIOD_DAYS = 14

export function getPaymentGraceEndsAt(startedAt: string, days = PAYMENT_GRACE_PERIOD_DAYS) {
  const start = new Date(startedAt)
  if (!Number.isFinite(start.getTime())) return null
  return new Date(start.getTime() + days * 24 * 60 * 60 * 1000).toISOString()
}

export function isPaymentGraceExpired(graceEndsAt: string | null | undefined, now = new Date()) {
  if (!graceEndsAt) return false
  const end = new Date(graceEndsAt)
  return Number.isFinite(end.getTime()) && end.getTime() <= now.getTime()
}

export async function expirePaymentGracePeriods(now = new Date()) {
  const supabase = createServiceRoleClient()
  const { data: fallback, error: fallbackError } = await supabase
    .from("plans")
    .select("key")
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("key", { ascending: true })
    .limit(1)
    .maybeSingle()
  if (fallbackError) throw new Error(fallbackError.message)
  if (!fallback?.key) throw new Error("No active fallback plan is configured.")
  const { data, error } = await supabase
    .from("workspace_subscriptions")
    .update({
      plan_key: fallback.key,
      billing_issue_code: "grace_expired",
      scheduled_plan_key: null,
      scheduled_plan_at: null,
      scheduled_effective_at: null,
      scheduled_plan_interval: null,
      scheduled_provider_price_id: null,
    })
    .neq("plan_key", fallback.key)
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
