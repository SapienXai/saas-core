import "server-only"

import { cache } from "react"
import {
  evaluatePlanChangeEligibility,
  evaluateEntitlementConsumption,
  getUsageSnapshot as buildUsageSnapshot,
  resolveEffectiveConsumptionLimit as resolveCoreEffectiveConsumptionLimit,
  type EntitlementErrorCode as CoreEntitlementErrorCode,
  type EntitlementLimit,
  type PlanChangeEligibility,
  type PlanChangeEligibilityReason,
} from "@sapienx/saas-core"
import { isPaymentGraceExpired } from "@/lib/billing/lifecycle"
import { getConfiguredFallbackPlanKey } from "@/lib/billing/reconciliation"
import { createServiceRoleClient } from "@/lib/supabase"
import { getProductUsageResolvers } from "@/src/product/usage"

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
  planSortOrder: number | null
  pricing: PlanPricing
  features: FeatureMap
  limits: LimitMap
  scheduledPlan: { key: PlanKey; name: string; sortOrder: number | null; pricing: PlanPricing; effectiveAt: string; limits: LimitMap } | null
  subscription: {
    status: string
    source: string
    currentPeriodStart: string | null
    currentPeriodEnd: string | null
    trialStartedAt: string | null
    trialEndsAt: string | null
    hasInitialTrial: boolean
    cancelAtPeriodEnd: boolean
    scheduledChangeAction: string | null
    scheduledChangeAt: string | null
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

export const ENTITLEMENT_ERROR_CODES = [
  "PLAN_LIMIT_REACHED",
  "FEATURE_NOT_AVAILABLE",
  "SUBSCRIPTION_REQUIRED",
  "INVALID_PLAN",
  "CAPABILITY_NOT_CONFIGURED",
  "USAGE_UNAVAILABLE",
  "INVALID_ENTITLEMENT_REQUEST",
] as const

export type EntitlementErrorCode = (typeof ENTITLEMENT_ERROR_CODES)[number]
  // Kept as compatibility aliases for existing product-owned error handling.
  | "FEATURE_NOT_INCLUDED"
  | "LIMIT_REACHED"
  | "PLAN_UNAVAILABLE"

export type EntitlementErrorDetails = {
  capability?: string
  feature?: FeatureKey
  limit?: LimitKey
  current?: number
  limitValue?: number | null
  remaining?: number | null
  unlimited?: boolean
  activeLimit?: number | null
  scheduledLimit?: number | null
  constrainedByScheduledPlan?: boolean
  scheduledPlanKey?: PlanKey
  requiredPlan?: PlanKey
  planKey?: PlanKey
}

/** A safe, serializable error boundary for server-side entitlement checks. */
export class EntitlementError extends Error {
  readonly code: EntitlementErrorCode
  readonly details: EntitlementErrorDetails
  readonly capability?: string
  readonly feature?: FeatureKey
  readonly limit?: LimitKey
  readonly current?: number
  readonly limitValue?: number | null
  readonly remaining?: number | null
  readonly unlimited?: boolean
  readonly activeLimit?: number | null
  readonly scheduledLimit?: number | null
  readonly constrainedByScheduledPlan?: boolean
  readonly scheduledPlanKey?: PlanKey
  readonly requiredPlan?: PlanKey
  readonly planKey?: PlanKey

  constructor(code: EntitlementErrorCode, message: string, details: EntitlementErrorDetails = {}) {
    super(message)
    this.name = "EntitlementError"
    this.code = code
    this.details = { ...details }
    this.capability = details.capability || details.feature || details.limit
    this.feature = details.feature
    this.limit = details.limit
    this.current = details.current
    this.limitValue = details.limitValue
    this.remaining = details.remaining
    this.unlimited = details.unlimited
    this.activeLimit = details.activeLimit
    this.scheduledLimit = details.scheduledLimit
    this.constrainedByScheduledPlan = details.constrainedByScheduledPlan
    this.scheduledPlanKey = details.scheduledPlanKey
    this.requiredPlan = details.requiredPlan
    this.planKey = details.planKey
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: {
        capability: this.capability,
        current: this.current,
        limit: this.limitValue,
        remaining: this.remaining,
        unlimited: this.unlimited,
        activeLimit: this.activeLimit,
        scheduledLimit: this.scheduledLimit,
        constrainedByScheduledPlan: this.constrainedByScheduledPlan,
        scheduledPlanKey: this.scheduledPlanKey,
        requiredPlan: this.requiredPlan,
        planKey: this.planKey,
      },
    }
  }
}

export type UsageResolverContext = {
  workspaceId: string
  userId?: string
  periodStart: string
  periodEnd: string
  now: Date
  /** Service-role database access is server-only and never comes from a client. */
  db: ReturnType<typeof createServiceRoleClient>
}

export type UsageResolver = (context: UsageResolverContext) => number | Promise<number>
export type UsageResolverMap = Readonly<Record<string, UsageResolver>>

export type EntitlementResolutionOptions = {
  userId?: string
  usageResolvers?: UsageResolverMap
  /** Retained for compatibility; unknown usage is always unavailable by default. */
  requireAuthoritativeUsage?: boolean
  now?: Date
  requiredPlan?: PlanKey
}

export type WorkspaceEntitlement = {
  capability: string
  kind: "feature" | "limit" | "mixed" | "unknown"
  configured: boolean
  feature?: boolean
  limit?: EntitlementLimit
  unlimited: boolean
}

export type WorkspaceEntitlementDecision = {
  capability: string
  allowed: boolean
  code: CoreEntitlementErrorCode | null
  current: number
  limit: EntitlementLimit
  remaining: number | null | undefined
  unlimited: boolean
  percentage: number | null
  overLimit: boolean
  activeLimit: EntitlementLimit
  scheduledLimit?: EntitlementLimit
  constrainedByScheduledPlan: boolean
  scheduledPlanKey?: PlanKey
  requiredPlan?: PlanKey
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
 * Missing keys stay unavailable. Only JSON null means unlimited; malformed
 * values are omitted so a bad catalog cannot grant unbounded access.
 */
export function normalizeLimits(value: unknown): LimitMap {
  const entries = Object.entries(asRecord(value)).reduce<Array<[string, number | null]>>((result, [key, limit]) => {
    if (limit === null || (typeof limit === "number" && Number.isSafeInteger(limit) && limit >= 0)) result.push([key, limit as number | null])
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

function effectiveNow(value?: Date) {
  return value && Number.isFinite(value.getTime()) ? value : new Date()
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
  scheduledChangeAction?: string | null
  cancelAtPeriodEnd?: boolean
  cancellationEffectiveAt?: string | null
  status?: string | null
  source?: string | null
  provider?: string | null
  providerEnvironment?: string | null
  providerCustomerId?: string | null
  providerSubscriptionId?: string | null
  providerPriceId?: string | null
  currentPeriodEndAt?: string | null
  initialTrialEndsAt?: string | null
  fallbackPlanKey?: string | null
  paymentGraceEndsAt?: string | null
  now?: Date
}

const KNOWN_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due", "paused", "canceled"])

function hasTrustedProviderProjection(input: EffectiveEntitlementPlanInput) {
  // Manual plan state is an explicit server-side decision and does not need a
  // provider identity. Every ordinary paid projection must be backed by the
  // complete local provider identity written by the verified billing boundary.
  if (input.source === "manual") return true
  if (input.source === "system") return false
  if (input.source === "trial") {
    return input.status === "trialing"
      && isValidTimestamp(input.initialTrialEndsAt)
      && new Date(input.initialTrialEndsAt).getTime() > effectiveNow(input.now).getTime()
  }
  const providerProjection = input.source === "provider" && typeof input.provider === "string" && /^[a-z][a-z0-9_-]{0,79}$/.test(input.provider)
  if (input.source !== undefined && !providerProjection) return false

  const providerFieldsWereSupplied = [
    input.provider,
    input.providerEnvironment,
    input.providerCustomerId,
    input.providerSubscriptionId,
    input.providerPriceId,
  ].some((value) => value !== undefined)
  // Keep the pure resolver useful for provider-neutral policy tests. The
  // server-backed resolver always supplies source and provider fields.
  if (!providerFieldsWereSupplied && input.source === undefined) return true

  return providerProjection
    && (input.providerEnvironment === "sandbox" || input.providerEnvironment === "live")
    && textValue(input.providerCustomerId) !== null
    && textValue(input.providerSubscriptionId) !== null
    && textValue(input.providerPriceId) !== null
}

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
  if (purchased !== fallback && !hasTrustedProviderProjection(input)) return fallback

  const now = effectiveNow(input.now)
  if (purchased !== fallback && input.currentPeriodEndAt && (!isValidTimestamp(input.currentPeriodEndAt) || isScheduledPlanEffective(input.currentPeriodEndAt, now))) return fallback
  if (status === "past_due") {
    // A past-due subscription without a valid boundary cannot grant an
    // unbounded grace period.
    if (!isValidTimestamp(input.paymentGraceEndsAt) || isPaymentGraceExpired(input.paymentGraceEndsAt, now)) return fallback
  }

  const cancellationScheduled = input.cancelAtPeriodEnd || input.scheduledChangeAction === "cancel" || input.scheduledChangeAction === "pause"
  if (cancellationScheduled) {
    const cancellationAt = input.cancellationEffectiveAt || input.scheduledPlanAt
    // A scheduled cancellation without a trustworthy boundary cannot grant
    // paid access indefinitely.
    if (!isValidTimestamp(cancellationAt) || isScheduledPlanEffective(cancellationAt, now)) return fallback
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

export type ProviderPriceTrust = "current" | "scheduled-target"

export type ProviderPriceTrustInput = EffectiveEntitlementPlanInput & {
  activeProviderPriceMapped: boolean
  scheduledTargetActive?: boolean
  scheduledTargetProviderPriceMapped?: boolean
  scheduledProviderPriceId?: string | null
}

/**
 * A provider can expose the future target price before the local entitlement
 * boundary. Accept that observation only when the target mapping is complete;
 * otherwise keep the paid projection fail-closed. The caller still decides
 * which local plan remains effective and which consumption ceiling applies.
 */
export function resolveProviderPriceTrust(input: ProviderPriceTrustInput): ProviderPriceTrust | null {
  if (!hasTrustedProviderProjection(input)) return null

  const action = textValue(input.scheduledChangeAction)
  if (action === "cancel" || action === "pause" || action === "resume") {
    return input.activeProviderPriceMapped ? "current" : null
  }
  if (action) return null

  const hasScheduledPriceProjection = [input.scheduledPlanKey, input.scheduledPlanAt, input.scheduledProviderPriceId]
    .some((value) => value !== undefined && value !== null)
  if (!hasScheduledPriceProjection) return input.activeProviderPriceMapped ? "current" : null

  // A plan-price transition is the only schedule that may accept the target
  // provider price early. Unknown actions and incomplete future boundaries are
  // not provider evidence and must never grant paid access.
  const scheduledPlanKey = validPlanKey(input.scheduledPlanKey)
  const scheduledAt = textValue(input.scheduledPlanAt)
  const scheduledProviderPriceId = textValue(input.scheduledProviderPriceId)
  const pendingTargetIsValid = Boolean(
    scheduledPlanKey &&
    scheduledAt &&
    scheduledProviderPriceId &&
    isScheduledPlanPending(scheduledAt, effectiveNow(input.now)) &&
    input.scheduledTargetActive === true &&
    input.scheduledTargetProviderPriceMapped === true,
  )
  if (!pendingTargetIsValid) return null

  if (input.activeProviderPriceMapped) return "current"
  return textValue(input.providerPriceId) === scheduledProviderPriceId ? "scheduled-target" : null
}

type SubscriptionRecord = {
  workspace_id: string
  plan_key: string
  status: string
  source: string
  current_period_start?: string | null
  current_period_end?: string | null
  scheduled_plan_key?: string | null
  scheduled_plan_at?: string | null
  scheduled_effective_at?: string | null
  scheduled_change_at?: string | null
  scheduled_change_action?: string | null
  current_period_start_at?: string | null
  current_period_end_at?: string | null
  initial_trial_started_at?: string | null
  initial_trial_ends_at?: string | null
  cancel_at_period_end?: boolean | null
  payment_failure_started_at?: string | null
  payment_grace_ends_at?: string | null
  billing_issue_code?: string | null
  provider?: string | null
  provider_environment?: string | null
  provider_customer_id?: string | null
  provider_subscription_id?: string | null
  provider_price_id?: string | null
  [key: string]: unknown
}

async function fallbackPlanKey(service: ReturnType<typeof createServiceRoleClient>) {
  try {
    return await getConfiguredFallbackPlanKey(service)
  } catch {
    throw new EntitlementError("SUBSCRIPTION_REQUIRED", "No fallback plan is configured for this workspace.")
  }
}

const getSubscription = cache(async function getSubscription(workspaceId: string): Promise<SubscriptionRecord & { override_id: string | null; override_plan_key: string | null; grace_expired: boolean }> {
  const service = createServiceRoleClient() as any
  let { data, error } = await service
    .from("workspace_subscriptions")
    .select("workspace_id, plan_key, status, source, provider, provider_environment, provider_customer_id, provider_subscription_id, provider_price_id, current_period_start, current_period_end, current_period_start_at, current_period_end_at, initial_trial_started_at, initial_trial_ends_at, cancel_at_period_end, scheduled_change_at, scheduled_change_action, scheduled_plan_key, scheduled_plan_at, scheduled_effective_at, scheduled_provider_price_id, payment_failure_started_at, payment_grace_ends_at, billing_issue_code")
    .eq("workspace_id", workspaceId)
    .maybeSingle()
  if (error?.code === "42703" && String(error.message || "").includes("initial_trial_")) {
    const legacy = await service
      .from("workspace_subscriptions")
      .select("workspace_id, plan_key, status, source, provider, provider_environment, provider_customer_id, provider_subscription_id, provider_price_id, current_period_start, current_period_end, current_period_start_at, current_period_end_at, cancel_at_period_end, scheduled_change_at, scheduled_change_action, scheduled_plan_key, scheduled_plan_at, scheduled_effective_at, scheduled_provider_price_id, payment_failure_started_at, payment_grace_ends_at, billing_issue_code")
      .eq("workspace_id", workspaceId)
      .maybeSingle()
    data = legacy.data ? { ...legacy.data, initial_trial_started_at: null, initial_trial_ends_at: null } : null
    error = legacy.error
  }
  if (error) throw new Error(error.message)

  // The subscription row is normally created by the workspace trigger. The
  // synthetic system subscription keeps old or partially migrated workspaces
  // on the configured Free/default plan instead of turning a missing row into
  // unlimited access.
  const resolvedFallback = data ? null : await fallbackPlanKey(service)
  const subscription: SubscriptionRecord = data || {
    workspace_id: workspaceId,
    plan_key: resolvedFallback,
    status: "active",
    source: "system",
    current_period_start: null,
    current_period_end: null,
    current_period_start_at: null,
    current_period_end_at: null,
    initial_trial_started_at: null,
    initial_trial_ends_at: null,
    cancel_at_period_end: false,
    scheduled_change_at: null,
    scheduled_change_action: null,
    scheduled_plan_key: null,
    scheduled_plan_at: null,
    scheduled_effective_at: null,
    scheduled_provider_price_id: null,
    payment_failure_started_at: null,
    payment_grace_ends_at: null,
    billing_issue_code: null,
  }

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

  const scheduledPlanKey = typeof subscription.scheduled_plan_key === "string" ? subscription.scheduled_plan_key : null
  const scheduledPlanAt = subscription.scheduled_effective_at || subscription.scheduled_plan_at || null
  const paymentGraceEndsAt = textValue(subscription.payment_grace_ends_at)
  const graceExpired = !override?.plan_key && subscription.status === "past_due" && (
    !isValidTimestamp(paymentGraceEndsAt) || isPaymentGraceExpired(paymentGraceEndsAt)
  )
  return {
    ...subscription,
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
  const fallback = await fallbackPlanKey(service)
  const planKeys = Array.from(new Set([
    validPlanKey(subscription.plan_key),
    validPlanKey(subscription.override_plan_key),
    validPlanKey(subscription.scheduled_plan_key),
    fallback,
  ].filter((key): key is string => Boolean(key))))
  if (!planKeys.length) throw new EntitlementError("SUBSCRIPTION_REQUIRED", "Workspace plan is not available.")
  const { data: plans, error } = await service
    .from("plans")
    .select("key, name, sort_order, features, limits, metadata")
    .in("key", planKeys)
    .eq("active", true)
  if (error) throw new Error(error.message)

  const activePlans = Array.isArray(plans) ? plans : []
  const fallbackPlan = activePlans.find((item: any) => item.key === fallback)
  if (!fallbackPlan) throw new EntitlementError("SUBSCRIPTION_REQUIRED", "The configured fallback plan is unavailable.")

  const now = new Date()
  let resolvedKey = resolveEffectiveEntitlementPlan({
    subscriptionPlanKey: textValue(subscription.plan_key),
    overridePlanKey: textValue(subscription.override_plan_key),
    scheduledPlanKey: textValue(subscription.scheduled_plan_key),
    scheduledPlanAt: textValue(subscription.scheduled_plan_at),
    scheduledChangeAction: textValue(subscription.scheduled_change_action),
    cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    cancellationEffectiveAt: textValue(subscription.scheduled_change_at) || textValue(subscription.scheduled_effective_at) || textValue(subscription.current_period_end_at) || textValue(subscription.current_period_end),
    status: textValue(subscription.status),
    source: textValue(subscription.source),
    provider: textValue(subscription.provider),
    providerEnvironment: textValue(subscription.provider_environment),
    providerCustomerId: textValue(subscription.provider_customer_id),
    providerSubscriptionId: textValue(subscription.provider_subscription_id),
    providerPriceId: textValue(subscription.provider_price_id),
    currentPeriodEndAt: textValue(subscription.current_period_end_at) || textValue(subscription.current_period_end),
    initialTrialEndsAt: textValue(subscription.initial_trial_ends_at),
    fallbackPlanKey: fallback,
    paymentGraceEndsAt: textValue(subscription.payment_grace_ends_at),
    now,
  })
  let providerMappingUnavailable = false
  if (resolvedKey && resolvedKey !== fallback && !subscription.override_id && subscription.source !== "manual" && subscription.source !== "trial") {
    const provider = textValue(subscription.provider)
    const providerEnvironment = textValue(subscription.provider_environment)
    const providerPriceId = textValue(subscription.provider_price_id)
    const scheduledAt = textValue(subscription.scheduled_plan_at)
    const scheduledPlanKey = validPlanKey(subscription.scheduled_plan_key)
    const scheduledProviderPriceId = textValue(subscription.scheduled_provider_price_id)
    const scheduledAction = textValue(subscription.scheduled_change_action)
    const pendingPriceTransition = Boolean(
      scheduledPlanKey &&
      scheduledAt &&
      isScheduledPlanPending(scheduledAt, now) &&
      !["cancel", "pause", "resume"].includes(scheduledAction || ""),
    )
    const effectiveProviderPriceId = scheduledPlanKey === resolvedKey && isScheduledPlanEffective(scheduledAt, now)
      ? scheduledProviderPriceId
      : providerPriceId
    const findActiveMapping = async (planKey: string | null, priceId: string | null) => {
      if (!provider || !providerEnvironment || !planKey || !priceId) return null
      const { data, error: mappingError } = await service
        .from("billing_provider_prices")
        .select("provider_price_id")
        .eq("provider", provider)
        .eq("environment", providerEnvironment)
        .eq("plan_key", planKey)
        .eq("provider_price_id", priceId)
        .eq("active", true)
        .maybeSingle()
      if (mappingError) throw new Error(mappingError.message)
      return data
    }

    const activeProviderMapping = await findActiveMapping(resolvedKey, effectiveProviderPriceId)
    const scheduledTargetMapping = pendingPriceTransition
      ? await findActiveMapping(scheduledPlanKey, scheduledProviderPriceId)
      : null
    const providerPriceTrust = pendingPriceTransition
      ? resolveProviderPriceTrust({
          source: textValue(subscription.source),
          provider,
          providerEnvironment,
          providerCustomerId: textValue(subscription.provider_customer_id),
          providerSubscriptionId: textValue(subscription.provider_subscription_id),
          providerPriceId,
          scheduledPlanKey,
          scheduledPlanAt: scheduledAt,
          scheduledChangeAction: scheduledAction,
          scheduledProviderPriceId,
          scheduledTargetActive: Boolean(scheduledPlanKey && activePlans.some((item: any) => item.key === scheduledPlanKey)),
          activeProviderPriceMapped: Boolean(activeProviderMapping),
          scheduledTargetProviderPriceMapped: Boolean(scheduledTargetMapping),
          currentPeriodEndAt: textValue(subscription.current_period_end_at) || textValue(subscription.current_period_end),
          status: textValue(subscription.status),
          subscriptionPlanKey: textValue(subscription.plan_key),
          fallbackPlanKey: fallback,
          now,
        })
      : activeProviderMapping
        ? "current"
        : null
    if (!providerPriceTrust) {
      resolvedKey = fallback
      providerMappingUnavailable = true
    }
  }
  // An inactive/removed subscription target or override must never make the
  // workspace plan lookup fail open. Keep the workspace on the safe fallback.
  const plan = activePlans.find((item: any) => item.key === resolvedKey) || fallbackPlan
  const invalidResolvedPlan = plan.key !== resolvedKey
  const status = textValue(subscription.status)
  const scheduledPlanKey = validPlanKey(subscription.scheduled_plan_key)
  const scheduledPlanAt = textValue(subscription.scheduled_plan_at)
  const scheduledChangeAt = textValue(subscription.scheduled_change_at) || textValue(subscription.scheduled_effective_at)
  const scheduledIsVisible = !providerMappingUnavailable && !subscription.grace_expired && status !== "paused" && status !== "canceled" && isScheduledPlanPending(scheduledPlanAt, now)
  const scheduled = scheduledIsVisible && scheduledPlanKey && scheduledPlanAt
    ? activePlans.find((item: any) => item.key === scheduledPlanKey)
    : null

  return {
    workspaceId,
    planKey: String(plan.key),
    planName: typeof plan.name === "string" ? plan.name : String(plan.key),
    planSortOrder: Number.isSafeInteger(plan.sort_order) ? plan.sort_order : null,
    pricing: planPricing(plan.metadata),
    features: normalizeFeatures(plan.features),
    limits: normalizeLimits(plan.limits),
    scheduledPlan: scheduled ? {
      key: String(scheduled.key),
      name: scheduled.name,
      sortOrder: Number.isSafeInteger(scheduled.sort_order) ? scheduled.sort_order : null,
      pricing: planPricing(scheduled.metadata),
      effectiveAt: scheduledPlanAt!,
      limits: normalizeLimits(scheduled.limits),
    } : null,
    subscription: {
      status: subscription.status,
      source: subscription.override_id ? "manual" : subscription.source,
      currentPeriodStart: subscription.current_period_start || null,
      currentPeriodEnd: subscription.current_period_end || null,
      trialStartedAt: textValue(subscription.initial_trial_started_at),
      trialEndsAt: textValue(subscription.initial_trial_ends_at),
      hasInitialTrial: isValidTimestamp(subscription.initial_trial_ends_at),
      cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
      scheduledChangeAction: textValue(subscription.scheduled_change_action),
      scheduledChangeAt,
      overrideId: subscription.override_id,
      scheduledPlanKey: subscription.grace_expired ? null : subscription.scheduled_plan_key || null,
      scheduledPlanAt: subscription.grace_expired ? null : subscription.scheduled_plan_at || null,
      paymentFailureStartedAt: subscription.payment_failure_started_at || null,
      paymentGraceEndsAt: subscription.payment_grace_ends_at || null,
      billingIssueCode: subscription.billing_issue_code || (subscription.grace_expired ? "grace_expired" : providerMappingUnavailable ? "invalid_provider_mapping" : invalidResolvedPlan ? "invalid_plan" : null),
    },
  }
})

export const getWorkspaceEntitlements = getWorkspacePlan
export const getEffectivePlan = getWorkspacePlan
export const getEntitlements = getWorkspacePlan

type ScheduledConsumptionState = {
  mode: "none" | "downgrade" | "invalid"
  scheduledPlanKey: PlanKey | null
  scheduledPlan: WorkspaceEntitlements["scheduledPlan"]
}

function getScheduledConsumptionState(entitlements: WorkspaceEntitlements, now: Date): ScheduledConsumptionState {
  const subscription = entitlements.subscription
  const scheduledPlanKey = validPlanKey(subscription.scheduledPlanKey)
  const scheduledPlanAt = subscription.scheduledPlanAt || entitlements.scheduledPlan?.effectiveAt || null
  const scheduledPlan = entitlements.scheduledPlan
  if (subscription.billingIssueCode === "invalid_provider_mapping") {
    return { mode: "none", scheduledPlanKey: null, scheduledPlan: null }
  }
  if (!scheduledPlanKey || !isScheduledPlanPending(scheduledPlanAt, now)) {
    return { mode: "none", scheduledPlanKey: null, scheduledPlan: null }
  }

  // Cancellation, pause, and resume preserve the current plan's mutation
  // limits until their own lifecycle boundary. They are not downgrades.
  if (subscription.cancelAtPeriodEnd || ["cancel", "pause", "resume"].includes(subscription.scheduledChangeAction || "")) {
    return { mode: "none", scheduledPlanKey: null, scheduledPlan }
  }

  // A pending target that cannot be resolved or ordered is a malformed
  // schedule. Treat it as unavailable for quota consumption instead of
  // granting the active plan's limit indefinitely.
  if (!scheduledPlan || scheduledPlan.key !== scheduledPlanKey || entitlements.planSortOrder === null || scheduledPlan.sortOrder === null) {
    return { mode: "invalid", scheduledPlanKey, scheduledPlan }
  }
  if (scheduledPlan.sortOrder >= entitlements.planSortOrder) {
    // A scheduled upgrade or same-plan change does not invoke the downgrade
    // ceiling; the active plan remains the mutation authority until activation.
    return { mode: "none", scheduledPlanKey: null, scheduledPlan }
  }
  return { mode: "downgrade", scheduledPlanKey, scheduledPlan }
}

export function isExplicitScheduledDowngrade(entitlements: WorkspaceEntitlements, now = new Date()) {
  return getScheduledConsumptionState(entitlements, now).mode === "downgrade"
}

export type WorkspaceEffectiveConsumptionLimit = {
  limit: EntitlementLimit
  activeLimit: EntitlementLimit
  scheduledLimit?: EntitlementLimit
  constrainedByScheduledPlan: boolean
  scheduledPlanKey: PlanKey | null
}

function resolveWorkspaceEffectiveConsumptionLimit(entitlements: WorkspaceEntitlements, capability: string, now: Date): WorkspaceEffectiveConsumptionLimit {
  const activeLimit = Object.prototype.hasOwnProperty.call(entitlements.limits, capability)
    ? entitlements.limits[capability]
    : undefined
  const scheduled = getScheduledConsumptionState(entitlements, now)
  const scheduledLimit = scheduled.mode === "downgrade" && scheduled.scheduledPlan && Object.prototype.hasOwnProperty.call(scheduled.scheduledPlan.limits, capability)
    ? scheduled.scheduledPlan.limits[capability]
    : undefined
  const resolved = resolveCoreEffectiveConsumptionLimit({
    activeLimit,
    scheduledLimit,
    scheduledPlanIsDowngrade: scheduled.mode !== "none",
  })
  return { ...resolved, scheduledPlanKey: scheduled.mode === "none" ? null : scheduled.scheduledPlanKey }
}

/**
 * Return the server-side quota ceiling while leaving getLimit() and the
 * displayed plan on the active entitlement set. The result is safe for both
 * product usage resolvers and Core-owned capabilities.
 */
export async function getEffectiveConsumptionLimit(workspaceId: string, capability: string, userIdOrOptions?: string | EntitlementResolutionOptions, options: EntitlementResolutionOptions = {}): Promise<WorkspaceEffectiveConsumptionLimit> {
  const resolvedOptions = resolveOptions(userIdOrOptions, options)
  const entitlements = await getWorkspaceEntitlements(workspaceId)
  return resolveWorkspaceEffectiveConsumptionLimit(entitlements, capability, effectiveNow(resolvedOptions.now))
}

export async function hasFeature(workspaceId: string, feature: FeatureKey) {
  try { return Boolean((await getWorkspaceEntitlements(workspaceId)).features[feature]) }
  catch (error) { console.error("Unable to resolve workspace feature entitlement:", error); return false }
}

export const can = hasFeature

export async function getLimit(workspaceId: string, limit: LimitKey): Promise<number | null | undefined> {
  const limits = (await getWorkspaceEntitlements(workspaceId)).limits
  return Object.prototype.hasOwnProperty.call(limits, limit) ? limits[limit] : undefined
}

function resolveOptions(userIdOrOptions?: string | EntitlementResolutionOptions, options: EntitlementResolutionOptions = {}) {
  const resolved = typeof userIdOrOptions === "string"
    ? { ...options, userId: userIdOrOptions }
    : { ...(userIdOrOptions || {}), ...options }
  const productResolvers = getProductUsageResolvers()
  const explicitResolvers = resolved.usageResolvers || {}
  const usageResolvers = Object.fromEntries([
    ...Object.entries(productResolvers),
    ...Object.entries(explicitResolvers),
  ].filter(([, resolver]) => typeof resolver === "function")) as UsageResolverMap
  return { ...resolved, usageResolvers }
}

function resolverResult(value: unknown, metric: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new EntitlementError("USAGE_UNAVAILABLE", `Authoritative usage for ${metric} is unavailable.`)
  return value
}

async function resolveUsageMetric(workspaceId: string, metric: UsageMetric, userId: string | undefined, options: EntitlementResolutionOptions, workspace: any, service: any, now: Date, period: { start: string; end: string }) {
  if (metric === "core.workspaces") {
    if (!workspace?.created_by) return 1
    const { count, error: countError } = await service.from("workspace_members").select("id", { count: "exact", head: true }).eq("user_id", workspace.created_by).eq("role", "owner")
    if (countError) throw new Error(countError.message)
    return count || 0
  }
  if (metric === "core.members") {
    const { count, error } = await service.from("workspace_members").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId)
    if (error) throw new Error(error.message)
    const { count: pending, error: invitationError } = await service.from("workspace_invitations").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).is("accepted_at", null).is("revoked_at", null).gt("expires_at", now.toISOString())
    if (invitationError) throw new Error(invitationError.message)
    return (count || 0) + (pending || 0)
  }

  const resolver = options.usageResolvers?.[metric]
  if (resolver) {
    try {
      return resolverResult(await resolver({ workspaceId, userId, periodStart: period.start, periodEnd: period.end, now, db: service }), metric)
    } catch (error) {
      if (!(error instanceof EntitlementError && error.code === "USAGE_UNAVAILABLE")) {
        console.error("Unable to resolve product usage:", { metric, code: "USAGE_RESOLVER_FAILED" })
      }
      throw new EntitlementError("USAGE_UNAVAILABLE", `Authoritative usage for ${metric} is unavailable.`)
    }
  }

  const { data, error } = await service.from("workspace_usage_periods").select("usage").eq("workspace_id", workspaceId).eq("period_start", period.start).eq("period_end", period.end).maybeSingle()
  if (error) throw new Error(error.message)
  const usage = normalizeUsage(data?.usage)
  if (Object.prototype.hasOwnProperty.call(usage, metric)) return usage[metric]
  throw new EntitlementError("USAGE_UNAVAILABLE", `Authoritative usage for ${metric} is unavailable.`)
}

export async function getUsage(workspaceId: string, metric: UsageMetric, userIdOrOptions?: string | EntitlementResolutionOptions, options: EntitlementResolutionOptions = {}) {
  const resolvedOptions = resolveOptions(userIdOrOptions, options)
  const workspace = await getWorkspaceRecord(workspaceId)
  const service = createServiceRoleClient() as any
  if (resolvedOptions.userId) {
    const { data: membership, error: membershipError } = await service
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", resolvedOptions.userId)
      .maybeSingle()
    if (membershipError) throw new Error(membershipError.message)
    if (!membership) throw new EntitlementError("PLAN_UNAVAILABLE", "Workspace is unavailable.")
  }
  const now = effectiveNow(resolvedOptions.now)
  return resolveUsageMetric(workspaceId, metric, resolvedOptions.userId, resolvedOptions, workspace, service, now, getCalendarPeriod(now))
}

export const getWorkspaceUsage = cache(async function getWorkspaceUsage(workspaceId: string, userIdOrOptions?: string | EntitlementResolutionOptions, options: EntitlementResolutionOptions = {}): Promise<WorkspaceUsage> {
  const resolvedOptions = resolveOptions(userIdOrOptions, options)
  const period = getCalendarPeriod(effectiveNow(resolvedOptions.now))
  const service = createServiceRoleClient() as any
  const [workspaces, users, usageResult] = await Promise.all([
    getUsage(workspaceId, "core.workspaces", resolvedOptions),
    getUsage(workspaceId, "core.members", resolvedOptions),
    service.from("workspace_usage_periods").select("usage").eq("workspace_id", workspaceId).eq("period_start", period.start).eq("period_end", period.end).maybeSingle(),
  ])
  if (usageResult.error) throw new Error(usageResult.error.message)
  const metrics = normalizeUsage(usageResult.data?.usage)
  const resolverEntries = await Promise.all(Object.keys(resolvedOptions.usageResolvers || {}).map(async (metric) => {
    try {
      return [metric, await getUsage(workspaceId, metric, resolvedOptions)] as const
    } catch (error) {
      if (error instanceof EntitlementError && error.code === "USAGE_UNAVAILABLE") {
        console.error("Unable to resolve product usage for Plan presentation:", { metric, code: error.code })
        return null
      }
      throw error
    }
  }))
  for (const entry of resolverEntries) if (entry) metrics[entry[0]] = entry[1]
  metrics["core.workspaces"] = workspaces
  metrics["core.members"] = users
  return { workspaceId, periodStart: period.start, periodEnd: period.end, metrics, workspaces, users }
})

export async function getRemaining(workspaceId: string, limit: LimitKey, userIdOrOptions?: string | EntitlementResolutionOptions, options: EntitlementResolutionOptions = {}) {
  const resolvedOptions = resolveOptions(userIdOrOptions, options)
  const value = await getLimit(workspaceId, limit)
  if (value === undefined) return undefined
  const usage = await getUsage(workspaceId, limit, {
    ...resolvedOptions,
    requireAuthoritativeUsage: resolvedOptions.requireAuthoritativeUsage ?? !["core.workspaces", "core.members"].includes(limit),
  })
  return value === null ? null : Math.max(0, value - usage)
}

export async function getUsageSnapshot(workspaceId: string, capability: string, userIdOrOptions?: string | EntitlementResolutionOptions, options: EntitlementResolutionOptions = {}) {
  const resolvedOptions = resolveOptions(userIdOrOptions, options)
  const limit = await getLimit(workspaceId, capability)
  const current = await getUsage(workspaceId, capability, {
    ...resolvedOptions,
    requireAuthoritativeUsage: !["core.workspaces", "core.members"].includes(capability),
  })
  return { capability, ...buildUsageSnapshot(current, limit) }
}

export async function getEntitlement(workspaceId: string, capability: string): Promise<WorkspaceEntitlement> {
  const entitlements = await getWorkspaceEntitlements(workspaceId)
  const hasFeatureKey = Object.prototype.hasOwnProperty.call(entitlements.features, capability)
  const hasLimitKey = Object.prototype.hasOwnProperty.call(entitlements.limits, capability)
  const kind = hasFeatureKey && hasLimitKey ? "mixed" : hasFeatureKey ? "feature" : hasLimitKey ? "limit" : "unknown"
  const limit = hasLimitKey ? entitlements.limits[capability] : undefined
  return {
    capability,
    kind,
    configured: hasFeatureKey || hasLimitKey,
    feature: hasFeatureKey ? entitlements.features[capability] : undefined,
    limit,
    unlimited: hasLimitKey && limit === null,
  }
}

function blockedPlanChangeEligibility(targetPlanKey: string, reason: PlanChangeEligibilityReason): PlanChangeEligibility {
  return {
    targetPlanKey,
    allowed: false,
    violations: [{ capability: "plan", reason }],
  }
}

/**
 * Resolve target-plan quota eligibility from the local catalog and
 * authoritative usage. This function is deliberately provider-neutral: the
 * caller decides whether the target is an upgrade or downgrade, while the
 * result is safe to use before any provider mutation.
 */
export async function validatePlanChangeEligibility(
  workspaceId: string,
  targetPlanKey: PlanKey,
  options: EntitlementResolutionOptions & {
    /** Product-owned local limits enforced when devices reconcile the new plan. */
    limitsReconciledOnDevice?: readonly string[]
  } = {},
): Promise<PlanChangeEligibility> {
  const normalizedTargetPlanKey = validPlanKey(targetPlanKey) || ""
  if (!normalizedTargetPlanKey) return blockedPlanChangeEligibility(normalizedTargetPlanKey, "INVALID_PLAN")

  const service = createServiceRoleClient() as any
  const { data: targetPlan, error: targetPlanError } = await service
    .from("plans")
    .select("key, limits, active")
    .eq("key", normalizedTargetPlanKey)
    .eq("active", true)
    .maybeSingle()
  if (targetPlanError) {
    console.error("Unable to load target plan for eligibility:", { code: "TARGET_PLAN_LOOKUP_FAILED" })
    return blockedPlanChangeEligibility(normalizedTargetPlanKey, "USAGE_UNAVAILABLE")
  }
  if (!targetPlan) return blockedPlanChangeEligibility(normalizedTargetPlanKey, "INVALID_PLAN")

  let currentEntitlements: WorkspaceEntitlements
  try {
    currentEntitlements = await getWorkspaceEntitlements(workspaceId)
  } catch {
    console.error("Unable to resolve current plan for target eligibility:", { code: "CURRENT_PLAN_LOOKUP_FAILED" })
    return blockedPlanChangeEligibility(normalizedTargetPlanKey, "USAGE_UNAVAILABLE")
  }

  const rawTargetLimits = asRecord(targetPlan.limits)
  const targetLimits = normalizeLimits(targetPlan.limits)
  const capabilities = new Set([...Object.keys(currentEntitlements.limits), ...Object.keys(rawTargetLimits)])
  const usageChecks = [...capabilities].filter((capability) =>
    !options.limitsReconciledOnDevice?.includes(capability) || !Object.hasOwn(targetLimits, capability),
  )
  const checks = await Promise.all(usageChecks.map(async (capability) => {
    if (!Object.prototype.hasOwnProperty.call(targetLimits, capability)) {
      return { capability, targetLimit: undefined, configured: false } as const
    }

    const targetLimit = targetLimits[capability]
    // Explicit unlimited does not require a product usage resolver. This is
    // both cheaper and preserves the distinction between null and undefined.
    if (targetLimit === null) return { capability, targetLimit, usageAvailable: true } as const

    const currentLimit = currentEntitlements.limits[capability]
    // A finite target only needs an authoritative usage read when it tightens
    // the current plan's limit. Requiring a product resolver for an unchanged
    // or wider capability can block unrelated downgrades (for example, a
    // per-device offline byte cap that is identical across every plan).
    if (typeof currentLimit === "number" && typeof targetLimit === "number" && targetLimit >= currentLimit) {
      return { capability, targetLimit, current: 0, usageAvailable: true } as const
    }

    try {
      const current = await getUsage(workspaceId, capability, options)
      return { capability, targetLimit, current, usageAvailable: true } as const
    } catch {
      console.error("Unable to resolve target-plan usage:", { capability, code: "TARGET_USAGE_UNAVAILABLE" })
      return { capability, targetLimit, usageAvailable: false } as const
    }
  }))

  return evaluatePlanChangeEligibility({ targetPlanKey: normalizedTargetPlanKey, checks })
}

export async function canConsume(workspaceId: string, capability: string, amount = 1, userIdOrOptions?: string | EntitlementResolutionOptions, options: EntitlementResolutionOptions = {}): Promise<WorkspaceEntitlementDecision> {
  const resolvedOptions = resolveOptions(userIdOrOptions, options)
  const entitlements = await getWorkspaceEntitlements(workspaceId)
  const feature = Object.prototype.hasOwnProperty.call(entitlements.features, capability) ? entitlements.features[capability] : undefined
  const consumption = resolveWorkspaceEffectiveConsumptionLimit(entitlements, capability, effectiveNow(resolvedOptions.now))
  const limit = consumption.limit
  const current = limit === undefined || limit === null || feature === false ? 0 : await getUsage(workspaceId, capability, {
    ...resolvedOptions,
    requireAuthoritativeUsage: !["core.workspaces", "core.members"].includes(capability),
  })
  const evaluatedDecision = evaluateEntitlementConsumption({ feature, limit, current, amount })
  // A pending downgrade with a missing target capability is malformed and
  // must stay unavailable even when the active plan also exposes a boolean
  // feature with the same key. Only an explicit target `null` is unlimited.
  const decision = consumption.constrainedByScheduledPlan && consumption.limit === undefined && consumption.activeLimit !== undefined
    ? { ...evaluatedDecision, allowed: false, code: "CAPABILITY_NOT_CONFIGURED" as const }
    : evaluatedDecision
  return {
    capability,
    ...decision,
    activeLimit: consumption.activeLimit,
    scheduledLimit: consumption.scheduledLimit,
    constrainedByScheduledPlan: consumption.constrainedByScheduledPlan,
    scheduledPlanKey: consumption.scheduledPlanKey || undefined,
    requiredPlan: resolvedOptions.requiredPlan,
  }
}

function errorMessage(code: CoreEntitlementErrorCode, capability: string) {
  if (code === "PLAN_LIMIT_REACHED") return `The ${capability} limit for the current plan has been reached.`
  if (code === "FEATURE_NOT_AVAILABLE") return `The ${capability} feature is not included in the current plan.`
  if (code === "CAPABILITY_NOT_CONFIGURED") return `The ${capability} entitlement is not configured for the current plan.`
  if (code === "INVALID_ENTITLEMENT_REQUEST") return `The requested ${capability} consumption is invalid.`
  return `The ${capability} entitlement is unavailable.`
}

export async function assertEntitlement(workspaceId: string, capability: string, options: EntitlementResolutionOptions & { amount?: number } = {}) {
  const decision = await canConsume(workspaceId, capability, options.amount ?? 1, options)
  if (!decision.allowed && decision.code) {
    const code = decision.code === "CAPABILITY_NOT_CONFIGURED" ? "INVALID_PLAN" : decision.code
    const entitlements = await getWorkspaceEntitlements(workspaceId)
    throw new EntitlementError(code, errorMessage(decision.code, capability), {
      capability,
      limit: decision.limit === undefined ? undefined : capability,
      current: decision.current,
      limitValue: decision.limit,
      remaining: decision.remaining === undefined ? undefined : decision.remaining,
      unlimited: decision.unlimited,
      activeLimit: decision.activeLimit === undefined ? undefined : decision.activeLimit,
      scheduledLimit: decision.scheduledLimit === undefined ? undefined : decision.scheduledLimit,
      constrainedByScheduledPlan: decision.constrainedByScheduledPlan,
      scheduledPlanKey: decision.scheduledPlanKey,
      requiredPlan: decision.requiredPlan,
      planKey: entitlements.planKey,
    })
  }
  return decision
}

export const assertCanConsume = assertEntitlement

export async function assertFeature(workspaceId: string, feature: FeatureKey) {
  const entitlements = await getWorkspaceEntitlements(workspaceId)
  if (!entitlements.features[feature]) throw new EntitlementError("FEATURE_NOT_AVAILABLE", "This feature is not included in the current plan.", { feature, capability: feature, planKey: entitlements.planKey })
  return true
}

export async function assertWithinLimit(workspaceId: string, limit: LimitKey, userIdOrOptions?: string | EntitlementResolutionOptions, options: EntitlementResolutionOptions = {}) {
  const resolvedOptions = resolveOptions(userIdOrOptions, options)
  const decision = await canConsume(workspaceId, limit, 1, resolvedOptions)
  if (decision.limit === undefined) throw new EntitlementError("INVALID_PLAN", "This plan limit is unavailable.", { limit, capability: limit, planKey: (await getWorkspaceEntitlements(workspaceId)).planKey })
  if (!decision.allowed) {
    throw new EntitlementError(decision.code === "FEATURE_NOT_AVAILABLE" ? "FEATURE_NOT_AVAILABLE" : "PLAN_LIMIT_REACHED", "This plan limit has been reached.", {
      limit,
      capability: limit,
      current: decision.current,
      limitValue: decision.limit,
      remaining: decision.remaining === undefined ? undefined : decision.remaining,
      unlimited: decision.unlimited,
      activeLimit: decision.activeLimit === undefined ? undefined : decision.activeLimit,
      scheduledLimit: decision.scheduledLimit === undefined ? undefined : decision.scheduledLimit,
      constrainedByScheduledPlan: decision.constrainedByScheduledPlan,
      scheduledPlanKey: decision.scheduledPlanKey,
      planKey: (await getWorkspaceEntitlements(workspaceId)).planKey,
    })
  }
  return decision
}

/** Return only the safe fields a route may serialize to a client. */
export function serializeEntitlementError(error: unknown) {
  if (error instanceof EntitlementError) return error.toJSON()
  return { code: "SUBSCRIPTION_REQUIRED" as const, message: "The entitlement could not be verified.", details: {} }
}

export function isEntitlementLimitError(error: unknown, limit?: LimitKey) {
  if (!error || typeof error !== "object") return false
  const candidate = error as { code?: string; details?: string; message?: string }
  return candidate.code === "PLAN_LIMIT_REACHED" || candidate.code === "LIMIT_REACHED" || candidate.details === `${limit?.toUpperCase().replaceAll(".", "_")}_LIMIT_REACHED` || candidate.message === "WORKSPACE_LIMIT_REACHED" || candidate.code === "P0001"
}

export function usageWarningPercent(usage: number, limit: number | null | undefined) {
  if (limit == null || limit <= 0) return null
  return Math.round((usage / limit) * 100)
}

export function createEntitlementService(defaultOptions: EntitlementResolutionOptions = {}) {
  return {
    getEffectivePlan,
    getEntitlements,
    validatePlanChangeEligibility: (workspaceId: string, targetPlanKey: PlanKey) => validatePlanChangeEligibility(workspaceId, targetPlanKey, defaultOptions),
    getEffectiveConsumptionLimit: (workspaceId: string, capability: string, userId?: string) => getEffectiveConsumptionLimit(workspaceId, capability, userId, defaultOptions),
    getEntitlement,
    hasFeature,
    getLimit,
    getUsage: (workspaceId: string, metric: UsageMetric, userId?: string) => getUsage(workspaceId, metric, userId, defaultOptions),
    getUsageSnapshot: (workspaceId: string, capability: string, userId?: string) => getUsageSnapshot(workspaceId, capability, userId, defaultOptions),
    getRemaining: (workspaceId: string, limit: LimitKey, userId?: string) => getRemaining(workspaceId, limit, userId, defaultOptions),
    canConsume: (workspaceId: string, capability: string, amount = 1, userId?: string) => canConsume(workspaceId, capability, amount, userId, defaultOptions),
    assertEntitlement: (workspaceId: string, capability: string, options: Omit<EntitlementResolutionOptions, "usageResolvers" | "now"> & { amount?: number } = {}) => assertEntitlement(workspaceId, capability, { ...defaultOptions, ...options }),
    assertCanConsume: (workspaceId: string, capability: string, amount = 1, userId?: string) => assertEntitlement(workspaceId, capability, { ...defaultOptions, userId, amount }),
    assertFeature: (workspaceId: string, feature: FeatureKey) => assertFeature(workspaceId, feature),
    assertWithinLimit: (workspaceId: string, limit: LimitKey, userId?: string) => assertWithinLimit(workspaceId, limit, userId, defaultOptions),
    getWorkspaceUsage: (workspaceId: string, userId?: string) => getWorkspaceUsage(workspaceId, userId, defaultOptions),
  }
}
