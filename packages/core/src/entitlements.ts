/**
 * Provider-neutral entitlement vocabulary and quota evaluation.
 *
 * A missing limit is unavailable. `null` is the only unlimited value. This
 * distinction is deliberately kept in the public contract so a missing or
 * malformed catalog cannot accidentally become unrestricted access.
 */

export type EntitlementLimit = number | null | undefined

export type EntitlementErrorCode =
  | "PLAN_LIMIT_REACHED"
  | "FEATURE_NOT_AVAILABLE"
  | "SUBSCRIPTION_REQUIRED"
  | "INVALID_PLAN"
  | "CAPABILITY_NOT_CONFIGURED"
  | "USAGE_UNAVAILABLE"
  | "INVALID_ENTITLEMENT_REQUEST"

export type UsageSnapshot = {
  current: number
  limit: EntitlementLimit
  remaining: number | null | undefined
  unlimited: boolean
  percentage: number | null
  overLimit: boolean
}

export type EntitlementDecision = UsageSnapshot & {
  allowed: boolean
  code: EntitlementErrorCode | null
}

export type EntitlementGateState =
  | "allowed"
  | "hidden"
  | "disabled"
  | "upgrade_required"
  | "limit_reached"
  | "over_limit"

export type EntitlementGateOptions = {
  /** Products may keep unavailable capabilities visible but disabled. */
  unavailableState?: "hidden" | "disabled"
}

export type PlanChangeEligibilityReason =
  | "LIMIT_EXCEEDED"
  | "USAGE_UNAVAILABLE"
  | "CAPABILITY_NOT_CONFIGURED"
  | "INVALID_PLAN"

export type PlanChangeEligibilityCheck = {
  capability: string
  targetLimit: EntitlementLimit
  /** Set false when the target plan cannot safely resolve this capability. */
  configured?: boolean
  /** Set false when authoritative usage could not be read. */
  usageAvailable?: boolean
  current?: number
}

export type PlanChangeEligibilityViolation = {
  capability: string
  reason: PlanChangeEligibilityReason
  current?: number
  targetLimit?: EntitlementLimit
  excess?: number
}

export type PlanChangeEligibility = {
  targetPlanKey: string
  allowed: boolean
  violations: readonly PlanChangeEligibilityViolation[]
}

/**
 * Evaluate whether a target plan can retain the resources already in use.
 * This is deliberately provider-neutral and does not perform I/O. Missing or
 * unavailable information blocks a downgrade; only `null` is unlimited.
 */
export function evaluatePlanChangeEligibility(input: {
  targetPlanKey: string
  checks: readonly PlanChangeEligibilityCheck[]
}): PlanChangeEligibility {
  const targetPlanKey = typeof input.targetPlanKey === "string" ? input.targetPlanKey.trim() : ""
  if (!targetPlanKey) {
    return { targetPlanKey, allowed: false, violations: [{ capability: "plan", reason: "INVALID_PLAN" }] }
  }

  const violations: PlanChangeEligibilityViolation[] = []
  for (const check of input.checks) {
    const capability = typeof check.capability === "string" ? check.capability.trim() : ""
    if (!capability || check.configured === false || check.targetLimit === undefined) {
      violations.push({ capability: capability || "capability", reason: "CAPABILITY_NOT_CONFIGURED", targetLimit: check.targetLimit })
      continue
    }
    if (check.targetLimit === null) continue
    if (check.usageAvailable === false || typeof check.current !== "number" || !Number.isFinite(check.current) || check.current < 0) {
      violations.push({ capability, reason: "USAGE_UNAVAILABLE", targetLimit: check.targetLimit })
      continue
    }
    if (!Number.isSafeInteger(check.targetLimit) || check.targetLimit < 0) {
      violations.push({ capability, reason: "CAPABILITY_NOT_CONFIGURED", targetLimit: undefined })
      continue
    }
    if (check.current > check.targetLimit) {
      violations.push({ capability, reason: "LIMIT_EXCEEDED", current: check.current, targetLimit: check.targetLimit, excess: check.current - check.targetLimit })
    }
  }

  return { targetPlanKey, allowed: violations.length === 0, violations }
}

export function isUnlimitedEntitlementLimit(limit: EntitlementLimit): limit is null {
  return limit === null
}

function assertUsageNumber(value: number, name: string) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a finite non-negative number.`)
}

/** Resolve a quota display from authoritative usage and a plan limit. */
export function getUsageSnapshot(current: number, limit: EntitlementLimit): UsageSnapshot {
  assertUsageNumber(current, "current")
  if (limit !== null && limit !== undefined) assertUsageNumber(limit, "limit")

  if (limit === undefined) {
    return { current, limit, remaining: undefined, unlimited: false, percentage: null, overLimit: false }
  }
  if (limit === null) {
    return { current, limit, remaining: null, unlimited: true, percentage: null, overLimit: false }
  }

  const percentage = limit === 0 ? (current > 0 ? 100 : 0) : Math.round((current / limit) * 100)
  return {
    current,
    limit,
    remaining: Math.max(0, limit - current),
    unlimited: false,
    percentage,
    overLimit: current > limit,
  }
}

/**
 * Evaluate one feature or quota without knowing what the product resource is.
 * `feature` and `limit` can both be supplied; a disabled feature always wins.
 */
export function evaluateEntitlementConsumption(input: {
  feature?: boolean
  limit?: EntitlementLimit
  current?: number
  amount?: number
}): EntitlementDecision {
  const current = input.current ?? 0
  const snapshot = getUsageSnapshot(current, input.limit)
  const amount = input.amount ?? 1

  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(current + amount)) {
    return { ...snapshot, allowed: false, code: "INVALID_ENTITLEMENT_REQUEST" }
  }
  if (input.feature === false) return { ...snapshot, allowed: false, code: "FEATURE_NOT_AVAILABLE" }

  if (input.limit === undefined) {
    return input.feature === true
      ? { ...snapshot, allowed: true, code: null }
      : { ...snapshot, allowed: false, code: "CAPABILITY_NOT_CONFIGURED" }
  }
  if (input.limit === null || current + amount <= input.limit) {
    return { ...snapshot, allowed: true, code: null }
  }
  return { ...snapshot, allowed: false, code: "PLAN_LIMIT_REACHED" }
}

export function evaluateFeatureAccess(feature: boolean | undefined) {
  return feature === true
}

/**
 * Resolve a small client-facing state from the same decision used by server
 * guards. This is advisory UI state; it never replaces server enforcement.
 */
export function getEntitlementGateState(
  input: {
    feature?: boolean
    limit?: EntitlementLimit
    current?: number
    amount?: number
  },
  options: EntitlementGateOptions = {},
): EntitlementGateState {
  const decision = evaluateEntitlementConsumption(input)
  if (decision.allowed) return "allowed"
  if (decision.code === "FEATURE_NOT_AVAILABLE") return options.unavailableState || "hidden"
  if (decision.code === "PLAN_LIMIT_REACHED") return decision.overLimit ? "over_limit" : "limit_reached"
  if (decision.code === "CAPABILITY_NOT_CONFIGURED" || decision.code === "SUBSCRIPTION_REQUIRED" || decision.code === "INVALID_PLAN") return "upgrade_required"
  return "disabled"
}
