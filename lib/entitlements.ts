import "server-only"

import { cache } from "react"
import { isPaymentGraceExpired } from "@/lib/billing/lifecycle"
import { getConfiguredFallbackPlanKey } from "@/lib/billing/reconciliation"
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

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime())
}

export function normalizeFeatures(value: unknown): FeatureMap {
  return Object.fromEntries(Object.entries(asRecord(value)).flatMap(([key, enabled]) => (
    typeof enabled === "boolean" ? [[key, enabled]] : []
  )))
}

/**
 * Missing keys stay missing. Only JSON null means unlimited; malformed values
 * are omitted so callers cannot accidentally grant unlimited access.
 */
export function normalizeLimits(value: unknown): LimitMap {
  const entries = Object.entries(asRecord(value)).reduce<Array<[string, number | null]>>((result, [key, limit]) => {
    if (limit === null || (typeof limit === "number" && Number.isFinite(limit) && limit >= 0)) result.push([key, limit as number | null])
    return result
  }, [])
  return Object.fromEntries(entries)
}

export function normalizeUsage(value: unknown): UsageMap {
  return Object.fromEntries(Object.entries(asRecord(value)).flatMap(([key, counter]) => (
    typeof counter === "number" && Number.isFinite(counter) && counter >= 0 ? [[key, counter]] : []
  )))
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

function validPlanKey(value: unknown): string | null {
  return textValue(value)
}

function referenceDate(value: string | Date | undefined) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : new Date()
  if (typeof value === "string") {
    const parsed = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value)
    if (Number.isFinite(parsed.getTime())) return parsed
  }
  return new Date()
}

export function isScheduledPlanEffective(effectiveAt: string | null | undefined, now = new Date()) {
  if (!isValidTimestamp(effectiveAt)) return false
  return new Date(effectiveAt).getTime() <= now.getTime()
}

export function isScheduledPlanPending(effectiveAt: string | null | undefined, now = new Date()) {
  return isValidTimestamp(effectiveAt) && !isScheduledPlanEffective(effectiveAt, now)
}

export type EffectiveEntitlementPlanInput = {
  subscriptionPlanKey?: string | null
  overridePlanKey?: string | null
  scheduledPlanKey?: string | null
  scheduledPlanAt?: string | null
  status?: string | null
  fallbackPlanKey?: string | null
  paymentGraceEndsAt?: string | null
  now?: Date
}

const KNOWN_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due", "paused", "canceled"])

/**
 * Resolve all entitlement precedence in one place. Manual overrides win over
 * lifecycle and scheduled state. Unknown lifecycle or malformed mapping data
 * returns the configured fallback, which is the fail-closed result.
 */
export function resolveEffectiveEntitlementPlan(input: EffectiveEntitlementPlanInput): string | null {
  const fallback = validPlanKey(input.fallbackPlanKey)
  const override = validPlanKey(input.overridePlanKey)
  if (override) return override

  const status = textValue(input.status) || "active"
  if (!KNOWN_SUBSCRIPTION_STATUSES.has(status) || status === "paused" || status === "canceled") return fallback

  const purchased = validPlanKey(input.subscriptionPlanKey)
  if (!purchased) return fallback

  const now = input.now && Number.isFinite(input.now.getTime()) ? input.now : new Date()
  if (status === "past_due") {
    // A past-due subscription without a valid boundary cannot grant an
    // unbounded grace period.
    if (!isValidTimestamp(input.paymentGraceEndsAt) || isPaymentGraceExpired(input.paymentGraceEndsAt, now)) return fallback
  }

  const hasScheduledMapping = input.scheduledPlanKey != null || input.scheduledPlanAt != null
  if (hasScheduledMapping) {
    const scheduled = validPlanKey(input.scheduledPlanKey)
    if (!scheduled || !isValidTimestamp(input.scheduledPlanAt)) return fallback
    if (isScheduledPlanEffective(input.scheduledPlanAt, now)) return scheduled
  }
  return purchased
}

export const resolveEffectiveEntitlements = resolveEffectiveEntitlementPlan

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
  const paymentGraceEndsAt = textValue(data.payment_grace_ends_at)
  const graceExpired = !override?.plan_key && data.status === "past_due" && (
    !isValidTimestamp(paymentGraceEndsAt) || isPaymentGraceExpired(paymentGraceEndsAt)
  )
  return {
    ...data,
    override_id: override?.id || null,
    override_plan_key: textValue(override?.plan_key),
    scheduled_plan_key: scheduledPlanKey,
    scheduled_plan_at: scheduledPlanAt,
    payment_grace_ends_at: paymentGraceEndsAt,
    grace_expired: graceExpired,
  }
})

const getWorkspaceRecord = cache(async function getWorkspaceRecord(workspaceId: string) {
  if (!workspaceId.trim()) throw new EntitlementError("PLAN_UNAVAILABLE", "Workspace is unavailable.")
  const service = createServiceRoleClient() as any
  const { data, error } = await service
    .from("workspaces")
    .select("id, created_by, status, platform_status")
    .eq("id", workspaceId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data || data.status !== "active" || (data.platform_status !== undefined && data.platform_status !== "active")) {
    throw new EntitlementError("PLAN_UNAVAILABLE", "Workspace is unavailable.")
  }
  return data
})

export function resolveEffectivePlanKey(
  subscriptionPlanKey: string,
  overridePlanKey?: string | null,
  scheduledPlanKey?: string | null,
  scheduledPlanAt?: string | null,
  todayOrNow: string | Date = new Date(),
) {
  return resolveEffectiveEntitlementPlan({
    subscriptionPlanKey,
    overridePlanKey,
    scheduledPlanKey,
    scheduledPlanAt,
    status: "active",
    fallbackPlanKey: subscriptionPlanKey,
    now: referenceDate(todayOrNow),
  }) || subscriptionPlanKey
}

export const getWorkspacePlan = cache(async function getWorkspacePlan(workspaceId: string): Promise<WorkspaceEntitlements> {
  await getWorkspaceRecord(workspaceId)
  const subscription = await getSubscription(workspaceId)
  const service = createServiceRoleClient() as any
  const fallbackPlanKey = await getConfiguredFallbackPlanKey(service)
  const planKeys = Array.from(new Set([
    validPlanKey(subscription.plan_key),
    validPlanKey(subscription.override_plan_key),
    validPlanKey(subscription.scheduled_plan_key),
    fallbackPlanKey,
  ].filter((key): key is string => Boolean(key))))
  if (!planKeys.length) throw new EntitlementError("PLAN_UNAVAILABLE", "Workspace plan is not available.")
  const { data: plans, error } = await service
    .from("plans")
    .select("key, name, sort_order, features, limits, metadata")
    .in("key", planKeys)
    .eq("active", true)
  if (error) throw new Error(error.message)

  const activePlans = Array.isArray(plans) ? plans : []
  const now = new Date()
  const effectiveKey = resolveEffectiveEntitlementPlan({
    subscriptionPlanKey: textValue(subscription.plan_key),
    overridePlanKey: textValue(subscription.override_plan_key),
    scheduledPlanKey: textValue(subscription.scheduled_plan_key),
    scheduledPlanAt: textValue(subscription.scheduled_plan_at),
    status: textValue(subscription.status),
    fallbackPlanKey,
    paymentGraceEndsAt: textValue(subscription.payment_grace_ends_at),
    now,
  })
  const plan = activePlans.find((item: any) => item.key === effectiveKey)
  if (!plan) throw new EntitlementError("PLAN_UNAVAILABLE", "Workspace plan is not available.")
  const status = textValue(subscription.status)
  const scheduledIsVisible = !subscription.grace_expired && status !== "paused" && status !== "canceled" && isScheduledPlanPending(textValue(subscription.scheduled_plan_at), now)
  const scheduled = scheduledIsVisible && subscription.scheduled_plan_key && subscription.scheduled_plan_at
    ? activePlans.find((item: any) => item.key === subscription.scheduled_plan_key)
    : null

  return {
    workspaceId,
    planKey: String(plan.key),
    planName: typeof plan.name === "string" ? plan.name : String(plan.key),
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

export async function getLimit(workspaceId: string, limit: LimitKey): Promise<number | null | undefined> {
  const limits = (await getWorkspaceEntitlements(workspaceId)).limits
  return Object.prototype.hasOwnProperty.call(limits, limit) ? limits[limit] : undefined
}

export async function getUsage(workspaceId: string, metric: UsageMetric, userId?: string) {
  const workspace = await getWorkspaceRecord(workspaceId)
  const service = createServiceRoleClient() as any
  if (userId) {
    const { data: membership, error: membershipError } = await service
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .maybeSingle()
    if (membershipError) throw new Error(membershipError.message)
    if (!membership) throw new EntitlementError("PLAN_UNAVAILABLE", "Workspace is unavailable.")
  }
  if (metric === "core.workspaces") {
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
  return normalizeUsage(data?.usage)[metric] ?? 0
}

export const getWorkspaceUsage = cache(async function getWorkspaceUsage(workspaceId: string, userId?: string): Promise<WorkspaceUsage> {
  const period = getCalendarPeriod()
  const service = createServiceRoleClient() as any
  const [workspaces, users, usageResult] = await Promise.all([
    getUsage(workspaceId, "core.workspaces", userId),
    getUsage(workspaceId, "core.members", userId),
    service.from("workspace_usage_periods").select("usage").eq("workspace_id", workspaceId).eq("period_start", period.start).eq("period_end", period.end).maybeSingle(),
  ])
  if (usageResult.error) throw new Error(usageResult.error.message)
  const metrics = normalizeUsage(usageResult.data?.usage)
  metrics["core.workspaces"] = workspaces
  metrics["core.members"] = users
  return { workspaceId, periodStart: period.start, periodEnd: period.end, metrics, workspaces, users }
})

export async function getRemaining(workspaceId: string, limit: LimitKey) {
  const [value, usage] = await Promise.all([getLimit(workspaceId, limit), getUsage(workspaceId, limit)])
  if (value === undefined) return undefined
  return value === null ? null : Math.max(0, value - usage)
}

export async function assertFeature(workspaceId: string, feature: FeatureKey) {
  if (!(await can(workspaceId, feature))) throw new EntitlementError("FEATURE_NOT_INCLUDED", "This feature is not included in the current plan.", { feature })
}

export async function assertWithinLimit(workspaceId: string, limit: LimitKey) {
  const [value, usage] = await Promise.all([getLimit(workspaceId, limit), getUsage(workspaceId, limit)])
  if (value === undefined) throw new EntitlementError("PLAN_UNAVAILABLE", "This plan limit is unavailable.", { limit })
  if (value !== null && usage >= value) throw new EntitlementError("LIMIT_REACHED", "This plan limit has been reached.", { limit })
}

export function isEntitlementLimitError(error: unknown, limit?: LimitKey) {
  if (!error || typeof error !== "object") return false
  const candidate = error as { code?: string; details?: string; message?: string }
  return candidate.details === `${limit?.toUpperCase().replaceAll(".", "_")}_LIMIT_REACHED` || candidate.message === "WORKSPACE_LIMIT_REACHED" || candidate.code === "P0001"
}

export function usageWarningPercent(usage: number, limit: number | null | undefined) {
  if (limit == null || limit <= 0) return null
  return Math.round((usage / limit) * 100)
}
