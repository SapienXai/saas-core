export const PLATFORM_STATUS_FILTERS = ["all", "active", "attention", "suspended"] as const
export const PLATFORM_PLAN_FILTERS = ["all", "free", "starter", "pro", "business"] as const
export const PLATFORM_ACTIVITY_FILTERS = ["all", "recent", "inactive", "new"] as const
export const PLATFORM_BILLING_FILTERS = ["all", "active", "past_due", "manual_override", "needs_attention"] as const
export const PLATFORM_USAGE_FILTERS = ["all", "normal", "approaching", "at_limit"] as const
export const PLATFORM_DOMAIN_FILTERS = ["all", "connected", "pending", "problem", "none"] as const

export type PlatformStatusFilter = (typeof PLATFORM_STATUS_FILTERS)[number]
export type PlatformPlanFilter = (typeof PLATFORM_PLAN_FILTERS)[number]
export type PlatformActivityFilter = (typeof PLATFORM_ACTIVITY_FILTERS)[number]
export type PlatformBillingFilter = (typeof PLATFORM_BILLING_FILTERS)[number]
export type PlatformUsageFilter = (typeof PLATFORM_USAGE_FILTERS)[number]
export type PlatformDomainFilter = (typeof PLATFORM_DOMAIN_FILTERS)[number]

export type PlatformListFilters = {
  q: string
  status: PlatformStatusFilter
  plan: PlatformPlanFilter
  activity: PlatformActivityFilter
  billing: PlatformBillingFilter
  usage: PlatformUsageFilter
  domain: PlatformDomainFilter
  page: number
  pageSize: number
}

function oneOf<T extends readonly string[]>(value: string | undefined, values: T, fallback: T[number]): T[number] {
  return value && values.includes(value) ? value as T[number] : fallback
}

function positiveInt(value: string | undefined, fallback: number, max: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback
}

export function parsePlatformFilters(input: URLSearchParams | Record<string, string | undefined>): PlatformListFilters {
  const get = (key: string) => input instanceof URLSearchParams ? input.get(key) || undefined : input[key]
  return {
    q: (get("q") || "").trim().slice(0, 120),
    status: oneOf(get("status"), PLATFORM_STATUS_FILTERS, "all"),
    plan: oneOf(get("plan"), PLATFORM_PLAN_FILTERS, "all"),
    activity: oneOf(get("activity"), PLATFORM_ACTIVITY_FILTERS, "all"),
    billing: oneOf(get("billing"), PLATFORM_BILLING_FILTERS, "all"),
    usage: oneOf(get("usage"), PLATFORM_USAGE_FILTERS, "all"),
    domain: oneOf(get("domain"), PLATFORM_DOMAIN_FILTERS, "all"),
    page: positiveInt(get("page"), 1, 10000),
    pageSize: positiveInt(get("pageSize"), 30, 100),
  }
}

export function filtersHaveValues(filters: PlatformListFilters) {
  return Boolean(filters.q || filters.status !== "all" || filters.plan !== "all" || filters.activity !== "all" || filters.billing !== "all" || filters.usage !== "all" || filters.domain !== "all")
}
