export type BillingInterval = "month" | "year"
export type IntervalChangeTiming = "none" | "immediate" | "period_end"
export type IntervalProrationPolicy = "immediate" | "none"

export type BillingIntervalChangePolicy = {
  kind: "none" | "interval_change"
  timing: IntervalChangeTiming
  prorationPolicy: IntervalProrationPolicy | null
}

/**
 * Billing-cycle changes are deliberately asymmetric. Moving to annual billing
 * is an immediate, previewed provider mutation; moving back to monthly keeps
 * the already-paid annual period and changes at its end. This helper owns the
 * product policy while the provider adapter maps it to provider parameters.
 */
export function resolveBillingIntervalChangePolicy(
  currentInterval: BillingInterval | null | undefined,
  targetInterval: BillingInterval | null | undefined,
): BillingIntervalChangePolicy {
  const validCurrent = currentInterval === "month" || currentInterval === "year"
  const validTarget = targetInterval === "month" || targetInterval === "year"
  if (!validCurrent || !validTarget || currentInterval === targetInterval) {
    return { kind: "none", timing: "none", prorationPolicy: null }
  }

  if (currentInterval === "month" && targetInterval === "year") {
    return { kind: "interval_change", timing: "immediate", prorationPolicy: "immediate" }
  }

  return { kind: "interval_change", timing: "period_end", prorationPolicy: "none" }
}
