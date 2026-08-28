import "server-only"

import { cache } from "react"
import { isPaymentGraceExpired } from "@/lib/billing/lifecycle"
import { createServiceRoleClient } from "@/lib/supabase"

/**
 * Entitlements are intentionally keyed strings. Core evaluates the contract;
 * products own the catalog and can add feature or usage keys without a Core
 * migration.
 */
export type PlanKey = string
export type FeatureKey = string
export type LimitKey = string
export type UsageMetric = string
export type FeatureMap = Record<string, boolean>
export type LimitMap = Record<string, number | null>
export type UsageMap = Record<string, number>
export type PlanPricing = Record<string, { amount: number | null; currency: string }>

export type WorkspaceEntitlements = {
  workspaceId: string
  planKey: PlanKey
  planName: string
  pricing: PlanPricing
  features: FeatureMap
  limits: LimitMap
  scheduledPlan: { key: PlanKey; name: string; pricing: PlanPricing; effectiveAt: string; limits: LimitMap } | null
  subscription: {
    status: string
    source: string
    currentPeriodStart: string | null
    currentPeriodEnd: string | null
    overrideId?: string | null
    scheduledPlanKey: PlanKey | null
    scheduledPlanAt: string | null
    paymentFailureStartedAt: string | null
    paymentGraceEndsAt: string | null
    billingIssueCode: string | null
  }
}

export type WorkspaceUsage = {
  workspaceId: string
  periodStart: string
  periodEnd: string
  metrics: UsageMap
  /** Core structural metrics retained for the management shell. */
  workspaces: number
  users: number
}

export class EntitlementError extends Error {
  readonly code: "FEATURE_NOT_INCLUDED" | "LIMIT_REACHED" | "PLAN_UNAVAILABLE"
  readonly feature?: FeatureKey
  readonly limit?: LimitKey

  constructor(code: EntitlementError["code"], message: string, details: { feature?: FeatureKey; limit?: LimitKey } = {}) {
    super(message)
    this.name = "EntitlementError"
    this.code = code
    this.feature = details.feature
    this.limit = details.limit
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function normalizeFeatures(value: unknown): FeatureMap {
  return Object.fromEntries(Object.entries(asRecord(value)).map(([key, enabled]) => [key, Boolean(enabled)]))
}

function normalizeLimits(value: unknown): LimitMap {
  return Object.fromEntries(Object.entries(asRecord(value)).map(([key, limit]) => {
    if (limit === null || limit === undefined || limit === "null") return [key, null]
    const number = typeof limit === "number" ? limit : Number(limit)
    return [key, Number.isFinite(number) && number >= 0 ? number : null]
  }))
}

function normalizePricing(value: unknown): PlanPricing {
  return Object.fromEntries(Object.entries(asRecord(value)).flatMap(([interval, raw]) => {
    const entry = asRecord(raw)
    const amount = entry.amount === null || entry.amount === undefined ? null : Number(entry.amount)
    const currency = typeof entry.currency === "string" && /^[A-Z]{3}$/.test(entry.currency) ? entry.currency : "USD"
    return typeof amount === "number" && Number.isFinite(amount) && amount >= 0 ? [[interval, { amount, currency }]] : []
  }))
}

function planPricing(metadata: unknown): PlanPricing {
  return normalizePricing(asRecord(metadata).pricing)
}

export function getCalendarPeriod(date = new Date()) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1))
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

const getSubscription = cache(async function getSubscription(workspaceId: string) {
  const service = createServiceRoleClient() as any
  const { data, error } = await service
    .from("workspace_subscriptions")
    .select("workspace_id, plan_key, status, source, current_period_start, current_period_end, scheduled_plan_key, scheduled_plan_at, scheduled_effective_at, payment_failure_started_at, payment_grace_ends_at, billing_issue_code")
    .eq("workspace_id", workspaceId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new EntitlementError("PLAN_UNAVAILABLE", "Workspace plan is not configured.")

  const now = new Date().toISOString()
  const { data: override, error: overrideError } = await service
    .from("subscription_overrides")
    .select("id, plan_key")
    .eq("workspace_id", workspaceId)
    .is("revoked_at", null)
    .lte("effective_from", now)
    .or(`effective_until.is.null,effective_until.gt.${now}`)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (overrideError && !["42P01", "42703"].includes(overrideError.code)) throw new Error(overrideError.message)

  const scheduledPlanKey = typeof data.scheduled_plan_key === "string" ? data.scheduled_plan_key : null
  const scheduledPlanAt = data.scheduled_effective_at || data.scheduled_plan_at || null
  return {
    ...data,
    override_id: override?.id || null,
    override_plan_key: override?.plan_key || null,
    scheduled_plan_key: scheduledPlanKey,
    scheduled_plan_at: scheduledPlanAt,
    grace_expired: !override?.plan_key && data.status === "past_due" && isPaymentGraceExpired(data.payment_grace_ends_at),
  }
})

export function resolveEffectivePlanKey(subscriptionPlanKey: string, overridePlanKey?: string | null, scheduledPlanKey?: string | null, scheduledPlanAt?: string | null, today = new Date().toISOString().slice(0, 10)) {
  if (overridePlanKey) return overridePlanKey
  const scheduled = scheduledPlanAt && scheduledPlanAt.length > 10
    ? new Date(scheduledPlanAt).getTime() <= new Date(`${today}T23:59:59.999Z`).getTime()
    : Boolean(scheduledPlanAt && scheduledPlanAt <= today)
  return scheduledPlanKey && scheduled ? scheduledPlanKey : subscriptionPlanKey
}

export const getWorkspacePlan = cache(async function getWorkspacePlan(workspaceId: string): Promise<WorkspaceEntitlements> {
  const subscription = await getSubscription(workspaceId)
  const service = createServiceRoleClient() as any
  const planKeys = Array.from(new Set([subscription.plan_key, subscription.scheduled_plan_key].filter(Boolean)))
  const { data: plans, error } = await service
    .from("plans")
    .select("key, name, sort_order, features, limits, metadata")
    .in("key", planKeys)
    .eq("active", true)
  if (error) throw new Error(error.message)

  let activePlans = plans || []
  if (subscription.grace_expired) {
    const fallback = await service.from("plans").select("key, name, sort_order, features, limits, metadata").eq("active", true).order("sort_order", { ascending: true }).order("key", { ascending: true }).limit(1).maybeSingle()
    if (fallback.error) throw new Error(fallback.error.message)
    if (fallback.data && !activePlans.some((item: any) => item.key === fallback.data.key)) activePlans = [...activePlans, fallback.data]
  }

  const effectiveKey = subscription.grace_expired
    ? activePlans.slice().sort((a: any, b: any) => a.sort_order - b.sort_order || a.key.localeCompare(b.key))[0]?.key
    : resolveEffectivePlanKey(subscription.plan_key, subscription.override_plan_key, subscription.scheduled_plan_key, subscription.scheduled_plan_at)
  const plan = activePlans.find((item: any) => item.key === effectiveKey)
  if (!plan) throw new EntitlementError("PLAN_UNAVAILABLE", "Workspace plan is not available.")
  const scheduled = !subscription.grace_expired && subscription.scheduled_plan_key && subscription.scheduled_plan_at
    ? activePlans.find((item: any) => item.key === subscription.scheduled_plan_key)
    : null

  return {
    workspaceId,
    planKey: String(plan.key),
    planName: plan.name,
    pricing: planPricing(plan.metadata),
    features: normalizeFeatures(plan.features),
    limits: normalizeLimits(plan.limits),
    scheduledPlan: scheduled ? {
      key: String(scheduled.key),
      name: scheduled.name,
      pricing: planPricing(scheduled.metadata),
      effectiveAt: subscription.scheduled_plan_at,
      limits: normalizeLimits(scheduled.limits),
    } : null,
    subscription: {
      status: subscription.status,
      source: subscription.override_id ? "manual" : subscription.source,
      currentPeriodStart: subscription.current_period_start,
      currentPeriodEnd: subscription.current_period_end,
      overrideId: subscription.override_id,
      scheduledPlanKey: subscription.grace_expired ? null : subscription.scheduled_plan_key,
      scheduledPlanAt: subscription.grace_expired ? null : subscription.scheduled_plan_at,
      paymentFailureStartedAt: subscription.payment_failure_started_at || null,
      paymentGraceEndsAt: subscription.payment_grace_ends_at || null,
      billingIssueCode: subscription.billing_issue_code || (subscription.grace_expired ? "grace_expired" : null),
    },
  }
})

export const getWorkspaceEntitlements = getWorkspacePlan

export async function can(workspaceId: string, feature: FeatureKey) {
  try { return Boolean((await getWorkspaceEntitlements(workspaceId)).features[feature]) }
  catch (error) { console.error("Unable to resolve workspace feature entitlement:", error); return false }
}

export async function getLimit(workspaceId: string, limit: LimitKey) {
  return (await getWorkspaceEntitlements(workspaceId)).limits[limit] ?? null
}

export async function getUsage(workspaceId: string, metric: UsageMetric) {
  const service = createServiceRoleClient() as any
  if (metric === "core.workspaces") {
    const { data: workspace, error } = await service.from("workspaces").select("created_by").eq("id", workspaceId).single()
    if (error) throw new Error(error.message)
    if (!workspace?.created_by) return 1
    const { count, error: countError } = await service.from("workspace_members").select("id", { count: "exact", head: true }).eq("user_id", workspace.created_by).eq("role", "owner")
    if (countError) throw new Error(countError.message)
    return count || 0
  }
  if (metric === "core.members") {
    const { count, error } = await service.from("workspace_members").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId)
    if (error) throw new Error(error.message)
    const { count: pending, error: invitationError } = await service.from("workspace_invitations").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).is("accepted_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString())
    if (invitationError) throw new Error(invitationError.message)
    return (count || 0) + (pending || 0)
  }

  const period = getCalendarPeriod()
  const { data, error } = await service.from("workspace_usage_periods").select("usage").eq("workspace_id", workspaceId).eq("period_start", period.start).eq("period_end", period.end).maybeSingle()
  if (error) throw new Error(error.message)
  const value = asRecord(data?.usage)[metric]
  const number = typeof value === "number" ? value : Number(value || 0)
  return Number.isFinite(number) && number >= 0 ? number : 0
}

export const getWorkspaceUsage = cache(async function getWorkspaceUsage(workspaceId: string): Promise<WorkspaceUsage> {
  const period = getCalendarPeriod()
  const [workspaces, users] = await Promise.all([getUsage(workspaceId, "core.workspaces"), getUsage(workspaceId, "core.members")])
  return { workspaceId, periodStart: period.start, periodEnd: period.end, metrics: { "core.workspaces": workspaces, "core.members": users }, workspaces, users }
})

export async function getRemaining(workspaceId: string, limit: LimitKey) {
  const [value, usage] = await Promise.all([getLimit(workspaceId, limit), getUsage(workspaceId, limit)])
  return value === null ? null : Math.max(0, value - usage)
}

export async function assertFeature(workspaceId: string, feature: FeatureKey) {
  if (!(await can(workspaceId, feature))) throw new EntitlementError("FEATURE_NOT_INCLUDED", "This feature is not included in the current plan.", { feature })
}

export async function assertWithinLimit(workspaceId: string, limit: LimitKey) {
  const [value, usage] = await Promise.all([getLimit(workspaceId, limit), getUsage(workspaceId, limit)])
  if (value !== null && usage >= value) throw new EntitlementError("LIMIT_REACHED", "This plan limit has been reached.", { limit })
}

export function isEntitlementLimitError(error: unknown, limit?: LimitKey) {
  if (!error || typeof error !== "object") return false
  const candidate = error as { code?: string; details?: string; message?: string }
  return candidate.details === `${limit?.toUpperCase().replaceAll(".", "_")}_LIMIT_REACHED` || candidate.message === "WORKSPACE_LIMIT_REACHED" || candidate.code === "P0001"
}

export function usageWarningPercent(usage: number, limit: number | null) {
  if (limit === null || limit <= 0) return null
  return Math.round((usage / limit) * 100)
}
