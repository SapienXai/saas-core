import { assertWithinLimit, getCalendarPeriod, getRemaining } from "./entitlements.js"
import type { Entitlements, UsagePeriod } from "./types.js"

export function usageKey(workspaceId: string, metric: string, periodStart: string): string {
  return `${workspaceId}:${metric}:${periodStart}`
}

export function createOrGetUsagePeriod(input: { workspaceId: string; metric: string; now?: Date; existing?: UsagePeriod | null }): UsagePeriod {
  if (input.existing) return input.existing
  const period = getCalendarPeriod(input.now)
  return { workspaceId: input.workspaceId, metric: input.metric, periodStart: period.start, periodEnd: period.end, amount: 0, updatedAt: (input.now ?? new Date()).toISOString() }
}

export function consumeUsage(input: { entitlements: Entitlements; period: UsagePeriod; amount?: number; now?: Date }): UsagePeriod {
  const amount = input.amount ?? 1
  if (!Number.isInteger(amount) || amount < 1) throw new RangeError("Usage amount must be a positive integer.")
  assertWithinLimit(input.entitlements, input.period.metric, input.period.amount, amount)
  return { ...input.period, amount: input.period.amount + amount, updatedAt: (input.now ?? new Date()).toISOString() }
}

export function remainingUsage(entitlements: Entitlements, period: UsagePeriod): number | null {
  return getRemaining(entitlements, period.metric, period.amount)
}
