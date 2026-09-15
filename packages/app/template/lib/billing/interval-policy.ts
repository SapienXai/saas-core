export type BillingInterval = "month" | "year"
export type IntervalChangeTiming = "none" | "immediate" | "period_end"
export type ProviderIntervalProrationMode = "prorated_immediately" | "do_not_bill"

export type BillingIntervalChangePolicy = {
  kind: "none" | "interval_change"
  timing: IntervalChangeTiming
  providerProrationBillingMode: ProviderIntervalProrationMode | null
}

/**
 * Billing-cycle changes are deliberately asymmetric. Moving to annual billing
 * is an immediate, previewed provider mutation; moving back to monthly keeps
 * the already-paid annual period and changes at its end. The provider adapter
 * supplies the concrete Paddle mode while this helper owns the product policy.
 */
export function resolveBillingIntervalChangePolicy(
  currentInterval: BillingInterval | null | undefined,
  targetInterval: BillingInterval | null | undefined,
): BillingIntervalChangePolicy {
  const validCurrent = currentInterval === "month" || currentInterval === "year"
  const validTarget = targetInterval === "month" || targetInterval === "year"
  if (!validCurrent || !validTarget || currentInterval === targetInterval) {
    return { kind: "none", timing: "none", providerProrationBillingMode: null }
  }

  if (currentInterval === "month" && targetInterval === "year") {
    return { kind: "interval_change", timing: "immediate", providerProrationBillingMode: "prorated_immediately" }
  }

  return { kind: "interval_change", timing: "period_end", providerProrationBillingMode: "do_not_bill" }
}
