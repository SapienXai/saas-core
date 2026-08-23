import { CoreError } from "./errors.js"
import type { Entitlements, Plan, Subscription, SubscriptionOverride } from "./types.js"

export function isGraceExpired(subscription: Subscription, now = new Date()): boolean {
  if (subscription.status !== "past_due" || !subscription.paymentGraceEndsAt) return false
  const end = new Date(subscription.paymentGraceEndsAt).getTime()
  return Number.isFinite(end) && end <= now.getTime()
}

export function resolveEffectivePlanKey(input: {
  subscription: Subscription
  override?: SubscriptionOverride | null
  now?: Date
}): string {
  const now = input.now ?? new Date()
  const override = input.override
  if (override && !override.revokedAt && new Date(override.effectiveFrom) <= now && (!override.effectiveUntil || new Date(override.effectiveUntil) > now)) return override.planKey
  if (isGraceExpired(input.subscription, now)) return "free"
  if (input.subscription.status === "paused" || input.subscription.status === "canceled") return "free"
  const scheduledAt = input.subscription.scheduledPlanAt ? new Date(input.subscription.scheduledPlanAt) : null
  if (input.subscription.scheduledPlanKey && scheduledAt && Number.isFinite(scheduledAt.getTime()) && scheduledAt <= now) return input.subscription.scheduledPlanKey
  return input.subscription.planKey
}

export function resolveEntitlements(input: {
  workspaceId: string
  plans: Iterable<Plan>
  subscription: Subscription
  override?: SubscriptionOverride | null
  now?: Date
}): Entitlements {
  const planMap = new Map([...input.plans].filter((plan) => plan.active).map((plan) => [plan.key, plan]))
  const key = resolveEffectivePlanKey(input)
  const plan = planMap.get(key)
  if (!plan) throw new CoreError("PLAN_UNAVAILABLE", "The workspace plan is not available.", { planKey: key })
  const scheduled = input.subscription.scheduledPlanKey && input.subscription.scheduledPlanAt && new Date(input.subscription.scheduledPlanAt) > (input.now ?? new Date())
    ? { key: input.subscription.scheduledPlanKey, effectiveAt: input.subscription.scheduledPlanAt }
    : null
  return {
    workspaceId: input.workspaceId,
    planKey: plan.key,
    planName: plan.name,
    features: { ...plan.features },
    limits: { ...plan.limits },
    subscription: { ...input.subscription },
    overrideId: input.override?.id ?? null,
    scheduledPlan: scheduled,
  }
}

export function canFeature(entitlements: Entitlements, feature: string): boolean {
  return entitlements.features[feature] === true
}

export function getLimit(entitlements: Entitlements, metric: string): number | null {
  return entitlements.limits[metric] ?? null
}

export function getRemaining(entitlements: Entitlements, metric: string, used: number): number | null {
  const limit = getLimit(entitlements, metric)
  return limit === null ? null : Math.max(0, limit - used)
}

export function assertFeature(entitlements: Entitlements, feature: string): void {
  if (!canFeature(entitlements, feature)) throw new CoreError("FEATURE_NOT_INCLUDED", `Feature ${feature} is not included in the current plan.`, { feature })
}

export function assertWithinLimit(entitlements: Entitlements, metric: string, used: number, increment = 1): void {
  const limit = getLimit(entitlements, metric)
  if (limit !== null && used + increment > limit) throw new CoreError("LIMIT_REACHED", `The ${metric} limit for this plan has been reached.`, { metric, limit, used, increment })
}

export function getCalendarPeriod(date = new Date()): { start: string; end: string } {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1))
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}
