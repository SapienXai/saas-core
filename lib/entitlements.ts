import { createServiceRoleClient } from "@/lib/supabase"
import { isPaymentGraceExpired } from "@/lib/billing/lifecycle"
import { cache } from "react"

export const PLAN_KEYS = ["free", "starter", "pro", "business"] as const
export type PlanKey = (typeof PLAN_KEYS)[number]

export const FEATURE_KEYS = [
  "hostedRestaurantPage",
  "emailNotifications",
  "removeReserveviaBranding",
  "customDomain",
  "basicAnalytics",
  "csvExport",
  "guestHistory",
  "automatedNotifications",
  "advancedReports",
  "customPWA",
  "pushNotifications",
  "multiRestaurant",
] as const
export type FeatureKey = (typeof FEATURE_KEYS)[number]

export const LIMIT_KEYS = ["restaurants", "users", "reservationsPerPeriod", "historyDays"] as const
export type LimitKey = (typeof LIMIT_KEYS)[number]

export type UsageMetric = LimitKey
export type FeatureMap = Record<FeatureKey, boolean>
export type LimitMap = Record<LimitKey, number | null>

export type WorkspaceEntitlements = {
  workspaceId: string
  planKey: PlanKey
  planName: string
  monthlyPriceUsdCents: number
  features: FeatureMap
  limits: LimitMap
  scheduledPlan: {
    key: PlanKey
    name: string
    effectiveAt: string
    limits: LimitMap
  } | null
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

export type WorkspaceRestaurantPlanState = {
  currentPlanKey: PlanKey
  currentPlanName: string
  currentLimit: number | null
  totalRestaurants: number
  liveRestaurantIds: string[]
  scheduledPlan: WorkspaceEntitlements["scheduledPlan"]
  affectedRestaurantIds: string[]
}

export type WorkspaceUsage = {
  workspaceId: string
  periodStart: string
  periodEnd: string
  reservationsCreated: number
  restaurants: number
  users: number
}

export class EntitlementError extends Error {
  readonly code: "FEATURE_NOT_INCLUDED" | "LIMIT_REACHED" | "PLAN_UNAVAILABLE"
  readonly feature?: FeatureKey
  readonly limit?: LimitKey

  constructor(
    code: EntitlementError["code"],
    message: string,
    details: { feature?: FeatureKey; limit?: LimitKey } = {},
  ) {
    super(message)
    this.name = "EntitlementError"
    this.code = code
    this.feature = details.feature
    this.limit = details.limit
  }
}

function isPlanKey(value: string | null | undefined): value is PlanKey {
  return Boolean(value && (PLAN_KEYS as readonly string[]).includes(value))
}

function normalizeFeatures(value: unknown): FeatureMap {
  const features = {} as FeatureMap
  for (const key of FEATURE_KEYS) {
    features[key] = Boolean(value && typeof value === "object" && (value as Record<string, unknown>)[key])
  }
  return features
}

function normalizePlanKey(value: string | null | undefined): PlanKey {
  if (!isPlanKey(value)) {
    throw new EntitlementError("PLAN_UNAVAILABLE", "Workspace plan is not configured.")
  }
  return value
}

export function getCalendarPeriod(date = new Date()) {
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()
  const start = new Date(Date.UTC(year, month, 1))
  const end = new Date(Date.UTC(year, month + 1, 1))
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  }
}

function isScheduledPlanColumnMissing(error: { code?: string | null; message?: string | null } | null | undefined) {
  const message = error?.message?.toLowerCase() || ""
  return error?.code === "42703" && (
    message.includes("scheduled_plan_key") ||
    message.includes("scheduled_plan_at") ||
    message.includes("scheduled_effective_at") ||
    message.includes("current_period_start_at") ||
    message.includes("payment_failure_started_at") ||
    message.includes("payment_grace_ends_at")
  )
}

const getSubscription = cache(async function getSubscription(workspaceId: string) {
  const supabase = createServiceRoleClient()
  let { data, error } = await supabase
    .from("workspace_subscriptions")
    .select("workspace_id, plan_key, status, source, current_period_start, current_period_end, current_period_start_at, current_period_end_at, scheduled_plan_key, scheduled_plan_at, scheduled_effective_at, payment_failure_started_at, payment_grace_ends_at, billing_issue_code")
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  // Keep reports and entitlement reads usable while a production database is
  // being brought up to the migration that introduced scheduled plan fields.
  // Once the migration is applied, the first query is used normally.
  if (error && isScheduledPlanColumnMissing(error)) {
    const legacyResult = await supabase
      .from("workspace_subscriptions")
      .select("workspace_id, plan_key, status, source, current_period_start, current_period_end")
      .eq("workspace_id", workspaceId)
      .maybeSingle()
    data = legacyResult.data
      ? { ...legacyResult.data, current_period_start_at: null, current_period_end_at: null, scheduled_plan_key: null, scheduled_plan_at: null, scheduled_effective_at: null, payment_failure_started_at: null, payment_grace_ends_at: null, billing_issue_code: null }
      : null
    error = legacyResult.error
  }

  if (error) throw new Error(error.message)
  if (!data) throw new EntitlementError("PLAN_UNAVAILABLE", "Workspace plan is not configured.")

  const overrideClient = createServiceRoleClient() as any
  const { data: override, error: overrideError } = await overrideClient
    .from("subscription_overrides")
    .select("id, plan_key")
    .eq("workspace_id", workspaceId)
    .is("revoked_at", null)
    .lte("effective_from", new Date().toISOString())
    .or(`effective_until.is.null,effective_until.gt.${new Date().toISOString()}`)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle()

  const overrideTableMissing = overrideError?.code === "42P01" || overrideError?.code === "42703" || overrideError?.message?.toLowerCase().includes("subscription_overrides")
  if (overrideError && !overrideTableMissing) throw new Error(overrideError.message)
  const scheduledPlanKey = isPlanKey(data.scheduled_plan_key) ? data.scheduled_plan_key : null
  const scheduledPlanAt = data.scheduled_effective_at || data.scheduled_plan_at || null
  const basePlanKey = data.plan_key
  const resolvedPlanKey = resolveEffectivePlanKey(data.plan_key, override?.plan_key, scheduledPlanKey, scheduledPlanAt)
  const paymentGraceExpired = !override?.plan_key && data.status === "past_due" && isPaymentGraceExpired(data.payment_grace_ends_at)
  const visibleScheduledPlanKey = paymentGraceExpired ? null : scheduledPlanKey
  const visibleScheduledPlanAt = paymentGraceExpired ? null : scheduledPlanAt

  return {
    ...data,
    plan_key: paymentGraceExpired ? "free" : resolvedPlanKey,
    base_plan_key: basePlanKey,
    scheduled_plan_key: visibleScheduledPlanKey,
    scheduled_plan_at: visibleScheduledPlanAt,
    override_id: override?.id || null,
    source: override?.id ? "manual" : data.source,
  }
})

export function resolveEffectivePlanKey(
  subscriptionPlanKey: string,
  overridePlanKey?: string | null,
  scheduledPlanKey?: string | null,
  scheduledPlanAt?: string | null,
  today = new Date().toISOString().slice(0, 10),
) {
  if (overridePlanKey) return overridePlanKey
  const effectiveNow = scheduledPlanAt && scheduledPlanAt.length > 10 ? new Date(today.length === 10 ? `${today}T23:59:59.999Z` : today).getTime() : Number.NaN
  const scheduledTime = scheduledPlanAt && scheduledPlanAt.length > 10 ? new Date(scheduledPlanAt).getTime() : Number.NaN
  const arrived = scheduledPlanAt && scheduledPlanAt.length > 10
    ? Number.isFinite(scheduledTime) && Number.isFinite(effectiveNow) && scheduledTime <= effectiveNow
    : Boolean(scheduledPlanAt && scheduledPlanAt <= today)
  if (scheduledPlanKey && arrived) return scheduledPlanKey
  return subscriptionPlanKey
}

export const getWorkspacePlan = cache(async function getWorkspacePlan(workspaceId: string): Promise<WorkspaceEntitlements> {
  const subscription = await getSubscription(workspaceId)
  const supabase = createServiceRoleClient()
  const planKeys = Array.from(new Set([subscription.plan_key, subscription.scheduled_plan_key].filter(Boolean)))
  const { data: plans, error } = await supabase
    .from("plans")
    .select("key, name, monthly_price_usd_cents, restaurant_limit, user_limit, reservation_limit, history_days, features")
    .in("key", planKeys)
    .eq("active", true)
  const plan = (plans || []).find((candidate) => candidate.key === subscription.plan_key)

  if (error || !plan) {
    throw new EntitlementError("PLAN_UNAVAILABLE", "Workspace plan is not available.")
  }

  const planKey = normalizePlanKey(plan.key)
  const now = new Date()
  const scheduledPlanRow = subscription.scheduled_plan_key && subscription.scheduled_plan_at && (
    subscription.scheduled_plan_at.length > 10
      ? new Date(subscription.scheduled_plan_at).getTime() > now.getTime()
      : subscription.scheduled_plan_at > now.toISOString().slice(0, 10)
  )
    ? (plans || []).find((candidate) => candidate.key === subscription.scheduled_plan_key)
    : null
  const toLimits = (candidate: typeof plan): LimitMap => ({
    restaurants: Number(candidate.restaurant_limit),
    users: Number(candidate.user_limit),
    reservationsPerPeriod: candidate.reservation_limit === null ? null : Number(candidate.reservation_limit),
    historyDays: candidate.history_days === null ? null : Number(candidate.history_days),
  })
  return {
    workspaceId,
    planKey,
    planName: plan.name,
    monthlyPriceUsdCents: Number(plan.monthly_price_usd_cents),
    features: normalizeFeatures(plan.features),
    limits: toLimits(plan),
    scheduledPlan: scheduledPlanRow && subscription.scheduled_plan_at
      ? {
          key: normalizePlanKey(scheduledPlanRow.key),
          name: scheduledPlanRow.name,
          effectiveAt: subscription.scheduled_plan_at,
          limits: toLimits(scheduledPlanRow),
        }
      : null,
    subscription: {
      status: subscription.status,
      source: subscription.source,
      currentPeriodStart: subscription.current_period_start,
      currentPeriodEnd: subscription.current_period_end,
      overrideId: subscription.override_id,
      scheduledPlanKey: subscription.scheduled_plan_key,
      scheduledPlanAt: subscription.scheduled_plan_at,
      paymentFailureStartedAt: subscription.payment_failure_started_at || null,
      paymentGraceEndsAt: subscription.payment_grace_ends_at || null,
      billingIssueCode: subscription.billing_issue_code || null,
    },
  }
})

export const getWorkspaceEntitlements = getWorkspacePlan

export const getWorkspaceRestaurantPlanState = cache(async function getWorkspaceRestaurantPlanState(workspaceId: string): Promise<WorkspaceRestaurantPlanState> {
  const [entitlements, restaurantsResult] = await Promise.all([
    getWorkspaceEntitlements(workspaceId),
    createServiceRoleClient()
      .from("restaurants")
      .select("id")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  ])
  if (restaurantsResult.error) throw new Error(restaurantsResult.error.message)

  const restaurantIds = (restaurantsResult.data || []).map((restaurant) => restaurant.id)
  const currentLimit = entitlements.limits.restaurants
  const liveRestaurantIds = currentLimit === null ? restaurantIds : restaurantIds.slice(0, currentLimit)
  const scheduledPlan = entitlements.scheduledPlan
  const scheduledLimit = scheduledPlan?.limits.restaurants ?? null
  const affectedRestaurantIds = scheduledPlan && scheduledLimit !== null
    ? restaurantIds.slice(scheduledLimit)
    : []

  return {
    currentPlanKey: entitlements.planKey,
    currentPlanName: entitlements.planName,
    currentLimit,
    totalRestaurants: restaurantIds.length,
    liveRestaurantIds,
    scheduledPlan,
    affectedRestaurantIds,
  }
})

export async function isRestaurantWithinWorkspacePlanLimit(workspaceId: string, restaurantId: string) {
  try {
    const state = await getWorkspaceRestaurantPlanState(workspaceId)
    return state.liveRestaurantIds.includes(restaurantId)
  } catch (error) {
    console.error("Unable to resolve restaurant plan access:", error)
    return false
  }
}

export async function getRestaurantEntitlements(restaurantId: string) {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from("restaurants")
    .select("workspace_id")
    .eq("id", restaurantId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data?.workspace_id) return null
  return getWorkspaceEntitlements(data.workspace_id)
}

export async function can(workspaceId: string, feature: FeatureKey) {
  try {
    const entitlements = await getWorkspaceEntitlements(workspaceId)
    return entitlements.features[feature]
  } catch (error) {
    console.error("Unable to resolve workspace feature entitlement:", error)
    return false
  }
}

export async function getLimit(workspaceId: string, limit: LimitKey) {
  const entitlements = await getWorkspaceEntitlements(workspaceId)
  return entitlements.limits[limit]
}

async function getUsagePeriod(workspaceId: string) {
  void workspaceId
  return getCalendarPeriod()
}

export type ReservationQuotaState = {
  usage: number
  limit: number | null
  available: boolean
  periodStart: string
  periodEnd: string
}

export async function getWorkspaceReservationQuotaState(workspaceId: string): Promise<ReservationQuotaState> {
  const [entitlements, usage] = await Promise.all([
    getWorkspaceEntitlements(workspaceId),
    getWorkspaceUsage(workspaceId),
  ])
  const limit = entitlements.limits.reservationsPerPeriod
  return {
    usage: usage.reservationsCreated,
    limit,
    available: limit === null || usage.reservationsCreated < limit,
    periodStart: usage.periodStart,
    periodEnd: usage.periodEnd,
  }
}

export async function getRestaurantReservationQuotaState(restaurantId: string) {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from("restaurants")
    .select("workspace_id")
    .eq("id", restaurantId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data?.workspace_id) return null
  return getWorkspaceReservationQuotaState(data.workspace_id)
}

export async function getUsage(workspaceId: string, metric: UsageMetric): Promise<number> {
  const supabase = createServiceRoleClient()
  if (metric === "restaurants") {
    const { count, error } = await supabase
      .from("restaurants")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
    if (error) throw new Error(error.message)
    return count || 0
  }

  if (metric === "users") {
    const { count, error } = await supabase
      .from("workspace_members")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
    if (error) throw new Error(error.message)
    const { count: pendingCount, error: pendingError } = await supabase
      .from("workspace_invitations")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
    if (pendingError) throw new Error(pendingError.message)
    return (count || 0) + (pendingCount || 0)
  }

  if (metric === "historyDays") {
    // History is an access limit, not a consumable usage counter. Callers
    // should use getLimit/getHistoryCutoff for this metric.
    return 0
  }

  const period = await getUsagePeriod(workspaceId)
  const { data, error } = await supabase
    .from("workspace_usage_periods")
    .select("reservations_created")
    .eq("workspace_id", workspaceId)
    .eq("period_start", period.start)
    .eq("period_end", period.end)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return Number(data?.reservations_created || 0)
}

export const getWorkspaceUsage = cache(async function getWorkspaceUsage(workspaceId: string): Promise<WorkspaceUsage> {
  const period = await getUsagePeriod(workspaceId)
  const [reservationsCreated, restaurants, users] = await Promise.all([
    getUsage(workspaceId, "reservationsPerPeriod"),
    getUsage(workspaceId, "restaurants"),
    getUsage(workspaceId, "users"),
  ])
  return { workspaceId, periodStart: period.start, periodEnd: period.end, reservationsCreated, restaurants, users }
})

export function restaurantCreationReason(usage: number, limit: number | null) {
  return limit !== null && usage >= limit ? "restaurant_limit" as const : null
}

export async function getRemaining(workspaceId: string, limit: LimitKey) {
  const [limitValue, usage] = await Promise.all([getLimit(workspaceId, limit), getUsage(workspaceId, limit)])
  return limitValue === null ? null : Math.max(0, limitValue - usage)
}

export async function getHistoryCutoff(workspaceId: string): Promise<string | null> {
  const days = (await getLimit(workspaceId, "historyDays"))
  if (days === null) return null
  const cutoff = new Date()
  cutoff.setUTCHours(0, 0, 0, 0)
  cutoff.setUTCDate(cutoff.getUTCDate() - days)
  return cutoff.toISOString().slice(0, 10)
}

export async function getHistoryCutoffsForRestaurants(restaurantIds: string[]) {
  if (restaurantIds.length === 0) return new Map<string, string | null>()
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from("restaurants")
    .select("id, workspace_id")
    .in("id", restaurantIds)
  if (error) throw new Error(error.message)

  const workspaceCutoffs = new Map<string, string | null>()
  await Promise.all(
    Array.from(new Set((data || []).map((row) => row.workspace_id).filter((id): id is string => Boolean(id)))).map(async (workspaceId) => {
      workspaceCutoffs.set(workspaceId, await getHistoryCutoff(workspaceId))
    }),
  )

  return new Map(
    (data || []).map((row) => [row.id, row.workspace_id ? workspaceCutoffs.get(row.workspace_id) ?? null : null]),
  )
}

export function isReservationVisibleInHistory(
  reservationDate: string,
  cutoff: string | null,
  today = new Date().toISOString().slice(0, 10),
) {
  return reservationDate >= today || cutoff === null || reservationDate >= cutoff
}

export async function assertFeature(workspaceId: string, feature: FeatureKey) {
  if (!(await can(workspaceId, feature))) {
    throw new EntitlementError("FEATURE_NOT_INCLUDED", "This feature is not included in the current plan.", { feature })
  }
}

export async function assertWithinLimit(workspaceId: string, limit: LimitKey) {
  const [limitValue, usage] = await Promise.all([getLimit(workspaceId, limit), getUsage(workspaceId, limit)])
  if (limitValue !== null && usage >= limitValue) {
    throw new EntitlementError("LIMIT_REACHED", "This plan limit has been reached.", { limit })
  }
}

export function isReservationQuotaError(error: unknown) {
  if (!error || typeof error !== "object") return false
  const candidate = error as { code?: string; message?: string; details?: string; hint?: string }
  return candidate.code === "P0001" ||
    candidate.details === "RESERVATION_LIMIT_REACHED" ||
    candidate.message?.includes("Monthly reservation limit reached") === true
}

export function isEntitlementLimitError(error: unknown, limit?: LimitKey) {
  if (!error || typeof error !== "object") return false
  const candidate = error as { code?: string; message?: string; details?: string }
  const expectedDetail = limit === "restaurants"
    ? "RESTAURANT_LIMIT_REACHED"
    : limit === "users"
      ? "USER_LIMIT_REACHED"
      : null
  return candidate.details === expectedDetail ||
    (candidate.code === "P0001" && Boolean(candidate.message?.toLowerCase().includes(`${limit === "restaurants" ? "restaurant" : "user"} limit reached`)))
}

export function reservationLimitMessage(isPublic: boolean) {
  return isPublic
    ? "Online reservations are temporarily unavailable. Please contact the restaurant."
    : "Monthly reservation limit reached. Review Plan & Usage for current usage."
}

export function usageWarningPercent(usage: number, limit: number | null) {
  if (limit === null || limit <= 0) return null
  return Math.round((usage / limit) * 100)
}
