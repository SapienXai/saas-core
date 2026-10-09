/**
 * Provider-neutral billing vocabulary and deterministic policy helpers.
 *
 * This module deliberately has no provider, persistence, framework, or
 * product-domain dependency. Provider adapters translate their own states to
 * these values before the application projects them into local entitlements.
 */

export const BILLING_INTERVALS = ["month", "year"] as const
export type BillingInterval = (typeof BILLING_INTERVALS)[number]
export type BillingEnvironment = "sandbox" | "live"

export function isBillingInterval(value: unknown): value is BillingInterval {
  return typeof value === "string" && (BILLING_INTERVALS as readonly string[]).includes(value)
}

export const BILLING_STATUSES = ["active", "trialing", "past_due", "paused", "canceled", "pending", "expired", "unpaid"] as const
export type BillingStatus = (typeof BILLING_STATUSES)[number]
export type BillingSubscriptionStatus = BillingStatus
export type BillingLifecycleStatus = BillingStatus

export function isBillingStatus(value: unknown): value is BillingStatus {
  return typeof value === "string" && (BILLING_STATUSES as readonly string[]).includes(value)
}

export const BILLING_TRANSITION_KINDS = [
  "checkout",
  "upgrade",
  "downgrade",
  "interval_change",
  "cancel",
  "resume",
  "renewal",
  "recovery",
] as const
export type BillingTransitionKind = (typeof BILLING_TRANSITION_KINDS)[number]

export const BILLING_TRANSITION_STATES = ["pending", "succeeded", "failed", "unknown"] as const
export type BillingTransitionState = (typeof BILLING_TRANSITION_STATES)[number]
export type BillingOperationState = BillingTransitionState

export type BillingTransition = {
  id?: string
  kind: BillingTransitionKind
  state: BillingTransitionState
  fromPlanKey?: string | null
  toPlanKey?: string | null
  effectiveAt?: string | null
}

export const BILLING_OUTCOME_STATUSES = ["succeeded", "failed", "unknown"] as const
export type BillingOutcomeStatus = (typeof BILLING_OUTCOME_STATUSES)[number]

/** An operation result that makes uncertainty explicit after a provider call. */
export type BillingOperationOutcome<Data = unknown> =
  | { status: "succeeded"; data?: Data; providerReference?: string | null }
  | { status: "failed"; code?: string; message?: string; retryable?: boolean }
  | { status: "unknown"; reason?: string; operationId?: string; providerReference?: string | null }

export type BillingUnknownOutcome = Extract<BillingOperationOutcome, { status: "unknown" }>
export type BillingProviderOutcome<Data = unknown> = BillingOperationOutcome<Data>
export type BillingTransitionOutcome = BillingOperationOutcome

export type BillingRetryDecision = "retry" | "reconcile" | "stop"

export type BillingProrationMode = "immediate" | "next_period" | "none"

export type BillingProrationPolicy = {
  upgrade?: BillingProrationMode
  downgrade?: BillingProrationMode
  failure?: BillingProrationMode
}

export type BillingRetryPolicy = {
  maxAttempts?: number
  initialDelaySeconds?: number
  maxDelaySeconds?: number
}

/** Optional product policy. Omitting every field preserves existing behavior. */
export type ProductBillingPolicy = {
  /** Must identify an existing catalog plan when supplied. */
  defaultPlanKey?: string
  /** Fallback used when a paid state is paused, canceled, or grace-expired. */
  fallbackPlanKey?: string
  supportedIntervals?: readonly BillingInterval[]
  defaultInterval?: BillingInterval
  paymentGracePeriodDays?: number
  /** Short alias accepted for product configuration files. */
  gracePeriodDays?: number
  /** Duration for a no-card first-Workspace trial, when a product provisions one. */
  initialWorkspaceTrialDays?: number
  proration?: BillingProrationPolicy
  retry?: BillingRetryPolicy
}

export type ProductPlanPresentation = {
  label?: string
  description?: string
  highlights?: readonly string[]
}

export type ProductBillingComparisonRow = {
  key: string
  label: string
  kind?: "feature" | "limit"
  featureKey?: string
  limitKey?: string
}

/** Product-owned copy and ordering for a reusable billing surface. */
export type ProductBillingPresentation = {
  planOrder?: readonly string[]
  plans?: Readonly<Record<string, ProductPlanPresentation>>
  copy?: Readonly<Record<string, string>>
  featureKeys?: readonly string[]
  limitKeys?: readonly string[]
  comparison?: readonly ProductBillingComparisonRow[]
  comparisonRows?: readonly ProductBillingComparisonRow[]
}

export type ProductBillingConfig = ProductBillingPolicy & {
  presentation?: ProductBillingPresentation
}

export type ResolvedBillingPolicy = {
  defaultPlanKey: string | null
  fallbackPlanKey: string | null
  supportedIntervals: readonly BillingInterval[]
  defaultInterval: BillingInterval
  paymentGracePeriodDays: number
  proration: {
    upgrade: BillingProrationMode
    downgrade: BillingProrationMode
    failure: BillingProrationMode
  }
  retry: {
    maxAttempts: number
    initialDelaySeconds: number
    maxDelaySeconds: number
  }
}

export const DEFAULT_BILLING_POLICY: ResolvedBillingPolicy = {
  defaultPlanKey: null,
  fallbackPlanKey: null,
  supportedIntervals: BILLING_INTERVALS,
  defaultInterval: "month",
  paymentGracePeriodDays: 14,
  proration: {
    upgrade: "immediate",
    downgrade: "next_period",
    failure: "none",
  },
  retry: {
    maxAttempts: 3,
    initialDelaySeconds: 30,
    maxDelaySeconds: 3600,
  },
}

function finiteNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function copyRecord(value: Readonly<Record<string, string>> | undefined) {
  return value ? { ...value } : {}
}

export function resolveBillingPolicy(policy: ProductBillingPolicy = {}): ResolvedBillingPolicy {
  const supportedIntervals = policy.supportedIntervals?.length ? [...policy.supportedIntervals] : [...BILLING_INTERVALS]
  const defaultInterval = policy.defaultInterval && supportedIntervals.includes(policy.defaultInterval)
    ? policy.defaultInterval
    : supportedIntervals[0] || "month"
  return {
    defaultPlanKey: policy.defaultPlanKey ?? null,
    fallbackPlanKey: policy.fallbackPlanKey ?? policy.defaultPlanKey ?? null,
    supportedIntervals,
    defaultInterval,
    paymentGracePeriodDays: policy.paymentGracePeriodDays ?? policy.gracePeriodDays ?? DEFAULT_BILLING_POLICY.paymentGracePeriodDays,
    proration: {
      upgrade: policy.proration?.upgrade ?? DEFAULT_BILLING_POLICY.proration.upgrade,
      downgrade: policy.proration?.downgrade ?? DEFAULT_BILLING_POLICY.proration.downgrade,
      failure: policy.proration?.failure ?? DEFAULT_BILLING_POLICY.proration.failure,
    },
    retry: {
      maxAttempts: policy.retry?.maxAttempts ?? DEFAULT_BILLING_POLICY.retry.maxAttempts,
      initialDelaySeconds: policy.retry?.initialDelaySeconds ?? DEFAULT_BILLING_POLICY.retry.initialDelaySeconds,
      maxDelaySeconds: policy.retry?.maxDelaySeconds ?? DEFAULT_BILLING_POLICY.retry.maxDelaySeconds,
    },
  }
}

export const getBillingPolicy = resolveBillingPolicy

export function validateBillingPolicy(value: unknown, path = "billing"): asserts value is ProductBillingPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object.`)
  const policy = value as Record<string, unknown>
  for (const key of ["defaultPlanKey", "fallbackPlanKey"]) {
    if (policy[key] !== undefined && (typeof policy[key] !== "string" || !policy[key].trim())) throw new Error(`${path}.${key} must be a non-empty plan key.`)
  }
  if (policy.supportedIntervals !== undefined) {
    if (!Array.isArray(policy.supportedIntervals) || !policy.supportedIntervals.length || policy.supportedIntervals.some((interval) => !isBillingInterval(interval))) {
      throw new Error(`${path}.supportedIntervals must contain one or more supported billing intervals.`)
    }
    if (new Set(policy.supportedIntervals).size !== policy.supportedIntervals.length) throw new Error(`${path}.supportedIntervals must not contain duplicates.`)
  }
  if (policy.defaultInterval !== undefined && !isBillingInterval(policy.defaultInterval)) throw new Error(`${path}.defaultInterval is not a supported billing interval.`)
  if (policy.defaultInterval !== undefined && policy.supportedIntervals !== undefined && !policy.supportedIntervals.includes(policy.defaultInterval)) throw new Error(`${path}.defaultInterval must be listed in supportedIntervals.`)
  for (const key of ["paymentGracePeriodDays", "gracePeriodDays"]) {
    if (policy[key] !== undefined && (!finiteNonNegativeInteger(policy[key]) || Number(policy[key]) > 366)) throw new Error(`${path}.${key} must be an integer from 0 through 366.`)
  }
  if (policy.initialWorkspaceTrialDays !== undefined && (!finiteNonNegativeInteger(policy.initialWorkspaceTrialDays) || Number(policy.initialWorkspaceTrialDays) < 1 || Number(policy.initialWorkspaceTrialDays) > 90)) {
    throw new Error(`${path}.initialWorkspaceTrialDays must be an integer from 1 through 90.`)
  }
  if (policy.proration !== undefined) {
    if (!policy.proration || typeof policy.proration !== "object" || Array.isArray(policy.proration)) throw new Error(`${path}.proration must be an object.`)
    const proration = policy.proration as Record<string, unknown>
    for (const key of ["upgrade", "downgrade", "failure"]) {
      if (proration[key] !== undefined && !["immediate", "next_period", "none"].includes(String(proration[key]))) throw new Error(`${path}.proration.${key} is invalid.`)
    }
  }
  if (policy.retry !== undefined) {
    if (!policy.retry || typeof policy.retry !== "object" || Array.isArray(policy.retry)) throw new Error(`${path}.retry must be an object.`)
    const retry = policy.retry as Record<string, unknown>
    for (const key of ["maxAttempts", "initialDelaySeconds", "maxDelaySeconds"]) {
      if (retry[key] !== undefined && !finiteNonNegativeInteger(retry[key]) || key === "maxAttempts" && retry[key] !== undefined && Number(retry[key]) < 1) throw new Error(`${path}.retry.${key} must be a positive integer.`)
    }
    if (retry.initialDelaySeconds !== undefined && retry.maxDelaySeconds !== undefined && Number(retry.initialDelaySeconds) > Number(retry.maxDelaySeconds)) throw new Error(`${path}.retry.maxDelaySeconds must be at least initialDelaySeconds.`)
  }
}

const BILLING_KEY_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/

function validatePresentationCopy(value: unknown, path: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object.`)
  for (const [key, copy] of Object.entries(value)) {
    if (!BILLING_KEY_PATTERN.test(key) || typeof copy !== "string" || !copy.trim()) throw new Error(`${path}.${key} must be non-empty copy keyed by a valid key.`)
  }
}

export function validateBillingPresentation(value: unknown, path = "billing.presentation"): asserts value is ProductBillingPresentation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object.`)
  const presentation = value as Record<string, unknown>
  if (presentation.planOrder !== undefined) {
    if (!Array.isArray(presentation.planOrder) || presentation.planOrder.some((key) => typeof key !== "string" || !key.trim())) throw new Error(`${path}.planOrder must be a string array.`)
    if (new Set(presentation.planOrder).size !== presentation.planOrder.length) throw new Error(`${path}.planOrder must not contain duplicates.`)
  }
  if (presentation.copy !== undefined) validatePresentationCopy(presentation.copy, `${path}.copy`)
  for (const key of ["featureKeys", "limitKeys"]) {
    if (presentation[key] !== undefined) {
      if (!Array.isArray(presentation[key]) || presentation[key].some((item) => typeof item !== "string" || !BILLING_KEY_PATTERN.test(item))) throw new Error(`${path}.${key} must contain valid keys.`)
      if (new Set(presentation[key]).size !== presentation[key].length) throw new Error(`${path}.${key} must not contain duplicates.`)
    }
  }
  for (const key of ["comparison", "comparisonRows"]) {
    if (presentation[key] !== undefined) {
      if (!Array.isArray(presentation[key])) throw new Error(`${path}.${key} must be an array.`)
      const keys = new Set<string>()
      for (const [index, row] of (presentation[key] as unknown[]).entries()) {
        if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`${path}.${key}[${index}] must be an object.`)
        const candidate = row as Record<string, unknown>
        if (typeof candidate.key !== "string" || !BILLING_KEY_PATTERN.test(candidate.key) || keys.has(candidate.key)) throw new Error(`${path}.${key}[${index}].key is invalid or duplicated.`)
        if (typeof candidate.label !== "string" || !candidate.label.trim()) throw new Error(`${path}.${key}[${index}].label is required.`)
        if (candidate.kind !== undefined && candidate.kind !== "feature" && candidate.kind !== "limit") throw new Error(`${path}.${key}[${index}].kind is invalid.`)
        if (candidate.featureKey !== undefined && (typeof candidate.featureKey !== "string" || !BILLING_KEY_PATTERN.test(candidate.featureKey))) throw new Error(`${path}.${key}[${index}].featureKey is invalid.`)
        if (candidate.limitKey !== undefined && (typeof candidate.limitKey !== "string" || !BILLING_KEY_PATTERN.test(candidate.limitKey))) throw new Error(`${path}.${key}[${index}].limitKey is invalid.`)
        keys.add(candidate.key)
      }
    }
  }
  if (presentation.plans !== undefined) {
    if (!presentation.plans || typeof presentation.plans !== "object" || Array.isArray(presentation.plans)) throw new Error(`${path}.plans must be an object keyed by plan.`)
    for (const [planKey, plan] of Object.entries(presentation.plans)) {
      if (!BILLING_KEY_PATTERN.test(planKey) || !plan || typeof plan !== "object" || Array.isArray(plan)) throw new Error(`${path}.plans.${planKey} is invalid.`)
      const candidate = plan as Record<string, unknown>
      for (const key of ["label", "description"]) if (candidate[key] !== undefined && (typeof candidate[key] !== "string" || !candidate[key].trim())) throw new Error(`${path}.plans.${planKey}.${key} must be non-empty copy.`)
      if (candidate.highlights !== undefined && (!Array.isArray(candidate.highlights) || candidate.highlights.some((item) => typeof item !== "string" || !item.trim()))) throw new Error(`${path}.plans.${planKey}.highlights must contain non-empty copy.`)
    }
  }
}

export function resolvePlanOrder(planKeys: readonly string[], requestedOrder?: readonly string[]): readonly string[] {
  if (!requestedOrder) return [...planKeys]
  const known = new Set(planKeys)
  if (requestedOrder.length !== planKeys.length || requestedOrder.some((key) => !known.has(key)) || new Set(requestedOrder).size !== requestedOrder.length) {
    throw new Error("Billing plan order must contain every catalog plan exactly once.")
  }
  return [...requestedOrder]
}

export function getBillingPlanOrder(planKeys: readonly string[], requestedOrder?: readonly string[]) {
  return resolvePlanOrder(planKeys, requestedOrder)
}

export function getPaymentGraceEndsAt(startedAt: string, days = 14): string | null {
  const start = new Date(startedAt)
  if (!Number.isFinite(start.getTime()) || !finiteNonNegativeInteger(days)) return null
  return new Date(start.getTime() + days * 24 * 60 * 60 * 1000).toISOString()
}

export function isPaymentGraceExpired(graceEndsAt: string | null | undefined, now = new Date()): boolean {
  if (!graceEndsAt) return false
  const end = new Date(graceEndsAt)
  return Number.isFinite(end.getTime()) && end.getTime() <= now.getTime()
}

export type EffectiveBillingPlanInput = {
  status: BillingStatus | string
  purchasedPlanKey: string
  fallbackPlanKey: string
  paymentGraceEndsAt?: string | null
  now?: Date
}

/** Non-entitled, terminal, and grace-expired states fail closed to the fallback. */
export function resolveEffectiveBillingPlan(input: EffectiveBillingPlanInput): string {
  const now = input.now ?? new Date()
  if (!isBillingStatus(input.status)) return input.fallbackPlanKey
  if (["paused", "canceled", "pending", "expired", "unpaid"].includes(input.status)) return input.fallbackPlanKey
  if (input.status === "past_due" && isPaymentGraceExpired(input.paymentGraceEndsAt, now)) return input.fallbackPlanKey
  return input.purchasedPlanKey
}

export const getEffectiveBillingPlan = resolveEffectiveBillingPlan

export function getSubscriptionPlanForStatus(
  status: BillingStatus | string,
  purchasedPlanKey: string,
  fallbackPlanKey: string = purchasedPlanKey,
  paymentGraceEndsAt?: string | null,
  now = new Date(),
) {
  return resolveEffectiveBillingPlan({ status, purchasedPlanKey, fallbackPlanKey, paymentGraceEndsAt, now })
}

const ALLOWED_STATUS_TRANSITIONS: Readonly<Record<BillingStatus, readonly BillingStatus[]>> = {
  active: ["active", "trialing", "past_due", "paused", "canceled", "unpaid"],
  trialing: ["trialing", "active", "past_due", "paused", "canceled", "expired"],
  past_due: ["past_due", "active", "paused", "canceled", "unpaid"],
  paused: ["paused", "active", "trialing", "canceled"],
  canceled: ["canceled", "active", "trialing"],
  pending: ["pending", "active", "trialing", "past_due", "canceled", "expired"],
  expired: ["expired"],
  unpaid: ["unpaid", "active", "canceled"],
}

export function isBillingTransitionAllowed(from: BillingStatus | string, to: BillingStatus | string): boolean {
  return isBillingStatus(from) && isBillingStatus(to) && ALLOWED_STATUS_TRANSITIONS[from].includes(to)
}

export type BillingTransitionDecision = "apply" | "schedule" | "reject" | "reconcile"

export function resolveBillingTransition(input: { from: BillingStatus | string; to: BillingStatus | string; state?: BillingTransitionState; effectiveAt?: string | null; now?: Date }): BillingTransitionDecision {
  if (input.state === "unknown") return "reconcile"
  if (input.state === "failed") return "reject"
  if (!isBillingTransitionAllowed(input.from, input.to)) return "reject"
  if (input.effectiveAt) {
    const effectiveAt = new Date(input.effectiveAt)
    if (!Number.isFinite(effectiveAt.getTime())) return "reject"
    if (effectiveAt.getTime() > (input.now ?? new Date()).getTime()) return "schedule"
  }
  return "apply"
}

export function getBillingTransitionDecision(input: Parameters<typeof resolveBillingTransition>[0]) {
  return resolveBillingTransition(input)
}

export type BillingRetryInput = {
  outcome: BillingOutcomeStatus | BillingTransitionState
  retryable?: boolean
  attempts?: number
  maxAttempts?: number
}

/** Unknown provider outcomes always reconcile before another financial call. */
export function resolveBillingRetry(input: BillingRetryInput): BillingRetryDecision {
  if (input.outcome === "unknown") return "reconcile"
  if (input.outcome === "succeeded") return "stop"
  if (input.retryable === false) return "stop"
  if (input.maxAttempts !== undefined && (input.attempts ?? 0) >= input.maxAttempts) return "stop"
  return "retry"
}

export const getBillingRetryDecision = resolveBillingRetry

export function shouldRetryBilling(input: BillingRetryInput): boolean {
  return resolveBillingRetry(input) === "retry"
}

export function getBillingProrationMode(change: "upgrade" | "downgrade" | "cancel" | "resume" | "recovery"): BillingProrationMode {
  if (change === "upgrade") return "immediate"
  if (change === "downgrade") return "next_period"
  return "none"
}

export const resolveProrationMode = getBillingProrationMode

export function resolveProrationPolicy(policy?: BillingProrationPolicy): Required<BillingProrationPolicy> {
  return {
    upgrade: policy?.upgrade ?? "immediate",
    downgrade: policy?.downgrade ?? "next_period",
    failure: policy?.failure ?? "none",
  }
}

export function normalizeBillingCopy(copy?: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return copyRecord(copy)
}
