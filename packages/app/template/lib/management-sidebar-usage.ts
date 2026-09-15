export type SidebarUsageItem = {
  key: string
  label: string
  used: number | undefined
  limit: number | null | undefined
}

type BillingPresentation = {
  limitKeys?: readonly string[]
  copy?: Readonly<Record<string, string>>
  comparison?: readonly BillingComparisonRow[]
  comparisonRows?: readonly BillingComparisonRow[]
}

type BillingComparisonRow = {
  key?: string
  label?: string
  kind?: "feature" | "limit"
  limitKey?: string
}

type ProductUsageMetric = {
  key?: string
  name?: string
}

type ProductConfigLike = {
  billingPresentation?: BillingPresentation
  billing?: { presentation?: BillingPresentation }
  billingPolicy?: { presentation?: BillingPresentation }
  catalog?: {
    usageMetrics?: readonly ProductUsageMetric[]
    presentation?: BillingPresentation
    billingPresentation?: BillingPresentation
    billing?: { presentation?: BillingPresentation }
    billingPolicy?: { presentation?: BillingPresentation }
  }
}

type UsageLike = {
  workspaces?: unknown
  users?: unknown
  metrics?: unknown
}

type LimitsLike = Record<string, unknown>

const DEFAULT_LIMIT_KEYS = ["core.workspaces", "core.members"] as const

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asProductConfig(value: unknown): ProductConfigLike {
  return asRecord(value) as ProductConfigLike
}

function resolveBillingPresentation(productConfig: ProductConfigLike): BillingPresentation | undefined {
  const catalog = productConfig.catalog
  return productConfig.billingPresentation
    || productConfig.billing?.presentation
    || productConfig.billingPolicy?.presentation
    || catalog?.billingPresentation
    || catalog?.presentation
    || catalog?.billing?.presentation
    || catalog?.billingPolicy?.presentation
}

function isKnownUsageValue(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function isKnownLimit(value: unknown): value is number | null {
  return value === null || isKnownUsageValue(value)
}

function humanizeCapabilityKey(key: string) {
  const humanized = key
    .replaceAll(/[._-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
  return humanized ? `${humanized[0].toUpperCase()}${humanized.slice(1)}` : "Usage"
}

function configuredLabel(key: string, presentation: BillingPresentation | undefined) {
  const rows = [...(presentation?.comparison || []), ...(presentation?.comparisonRows || [])]
  const row = rows.find((candidate) => candidate.limitKey === key || (candidate.key === key && candidate.kind !== "feature"))
  const rowLabel = row?.label?.trim()
  if (rowLabel) return rowLabel

  const copy = presentation?.copy
  return copy?.[key]?.trim() || copy?.[`limit.${key}`]?.trim() || null
}

function usageMetricName(key: string, productConfig: ProductConfigLike) {
  const metric = productConfig.catalog?.usageMetrics?.find((candidate) => candidate.key === key)
  return metric?.name?.trim() || null
}

function resolveLabel(
  key: string,
  productConfig: ProductConfigLike,
  coreLabels: Readonly<Record<string, string>>,
) {
  return configuredLabel(key, resolveBillingPresentation(productConfig))
    || usageMetricName(key, productConfig)
    || coreLabels[key]?.trim()
    || humanizeCapabilityKey(key)
}

function resolveUsageValue(key: string, usage: UsageLike) {
  const metrics = asRecord(usage.metrics)
  const structuralValue = key === "core.workspaces" ? usage.workspaces : key === "core.members" ? usage.users : undefined
  return isKnownUsageValue(structuralValue) ? structuralValue : isKnownUsageValue(metrics[key]) ? metrics[key] : undefined
}

/**
 * Build the compact management-sidebar usage model from authoritative server
 * usage and the product billing presentation contract. Unknown usage/limits
 * stay unknown; they never become a misleading zero or unlimited value.
 */
export function resolveSidebarUsageItems(input: {
  usage?: UsageLike | null
  limits?: LimitsLike | null
  productConfig?: unknown
  coreLabels?: Readonly<Record<string, string>>
  maxItems?: number
}): SidebarUsageItem[] {
  if (!input.usage || !input.limits) return []

  const productConfig = asProductConfig(input.productConfig)
  const limits = input.limits
  const presentation = resolveBillingPresentation(productConfig)
  const requestedKeys = Array.isArray(presentation?.limitKeys) ? presentation.limitKeys : DEFAULT_LIMIT_KEYS
  const maxItems = Number.isSafeInteger(input.maxItems) && (input.maxItems as number) > 0 ? input.maxItems as number : 2
  const keys = [...new Set(requestedKeys)]
    .filter((key): key is string => typeof key === "string" && key.trim().length > 0)
    .slice(0, maxItems)
  const coreLabels = input.coreLabels || {}

  return keys.map((key) => ({
    key,
    label: resolveLabel(key, productConfig, coreLabels),
    used: resolveUsageValue(key, input.usage!),
    limit: Object.prototype.hasOwnProperty.call(limits, key) && isKnownLimit(limits[key]) ? limits[key] as number | null : undefined,
  }))
}
