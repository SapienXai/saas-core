"use client"

import { Button } from "./ui/button"
import { cn } from "../lib/utils"

export type BillingUsageValue = {
  current: number
  limit: number | null | undefined
  unlimited?: boolean
  unit?: string
}

export function BillingUsageMeter({ label, current, limit, unit, className }: BillingUsageValue & { label: string; className?: string }) {
  const finiteLimit = typeof limit === "number" ? limit : undefined
  const percentage = finiteLimit === undefined || finiteLimit <= 0 ? 0 : Math.min(100, Math.round((current / finiteLimit) * 100))
  const value = limit === undefined ? "Limit unavailable" : limit === null ? `${current.toLocaleString()} / Unlimited` : `${current.toLocaleString()} / ${limit.toLocaleString()}`

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium text-foreground">{label}</span>
        <span className="tabular-nums text-muted-foreground">{value}{unit ? ` ${unit}` : ""}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={limit === null || limit === undefined ? undefined : limit} aria-valuenow={limit === null || limit === undefined ? undefined : Math.min(current, limit)}>
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percentage}%` }} />
      </div>
    </div>
  )
}

export type EntitlementLimitNoticeProps = {
  capability: string
  label?: string
  current: number
  limit: number | null | undefined
  requiredPlan?: string
  description?: string
  actionLabel?: string
  onUpgrade?: () => void
  className?: string
}

export function EntitlementLimitNotice({ capability, label = capability, current, limit, requiredPlan, description, actionLabel = "Upgrade plan", onUpgrade, className }: EntitlementLimitNoticeProps) {
  const limitLabel = limit === null ? "Unlimited" : limit === undefined ? "Unavailable" : limit.toLocaleString()
  const title = limit === undefined ? `${label} is unavailable` : typeof limit === "number" && current > limit ? `${label} is over the current plan limit` : `You've reached your ${label} limit`

  return (
    <div className={cn("rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100", className)} role="alert">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 text-xs opacity-80">{description || `${label}: ${current.toLocaleString()} / ${limitLabel}${requiredPlan ? ` · ${requiredPlan} unlocks more` : ""}`}</p>
        </div>
        {onUpgrade && requiredPlan && <Button type="button" size="sm" onClick={onUpgrade}>{actionLabel}</Button>}
      </div>
    </div>
  )
}
