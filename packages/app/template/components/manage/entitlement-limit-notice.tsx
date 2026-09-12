import { AlertTriangle, ArrowUpRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

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

/** Product-neutral limit feedback for mutations and usage surfaces. */
export function EntitlementLimitNotice({ capability, label = capability, current, limit, requiredPlan, description, actionLabel = "Upgrade plan", onUpgrade, className }: EntitlementLimitNoticeProps) {
  const limitLabel = limit === null ? "Unlimited" : limit === undefined ? "Unavailable" : limit.toLocaleString()
  const title = limit === undefined ? `${label} is unavailable` : typeof limit === "number" && current > limit ? `${label} is over the current plan limit` : `You've reached your ${label} limit`

  return (
    <div className={cn("rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100", className)} role="alert" data-entitlement-capability={capability}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />{title}</p>
          <p className="mt-1 text-xs opacity-80">{description || `${label}: ${current.toLocaleString()} / ${limitLabel}${requiredPlan ? ` · ${requiredPlan} unlocks more` : ""}`}</p>
        </div>
        {onUpgrade && requiredPlan && <Button type="button" size="sm" onClick={onUpgrade}>{actionLabel}<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /></Button>}
      </div>
    </div>
  )
}
