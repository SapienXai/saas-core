import "server-only"

import type { PlanKey } from "@/lib/entitlements"
import { createServiceRoleClient } from "@/lib/supabase"
import type { BillingProviderEnvironment, BillingProviderName } from "./provider"

/** Provider-backed plan keys are product-owned and intentionally open-ended. */
export type PaidPlanKey = PlanKey
export const BILLING_INTERVALS = ["month", "year"] as const
export type BillingInterval = (typeof BILLING_INTERVALS)[number]

export function isBillingInterval(value: string): value is BillingInterval {
  return (BILLING_INTERVALS as readonly string[]).includes(value)
}

export function isPaidPlanKey(value: string): value is PaidPlanKey {
  return /^[a-z][a-z0-9_-]{0,63}$/.test(value)
}

export type ProviderPriceMapping = {
  id: string
  provider: BillingProviderName
  environment: BillingProviderEnvironment
  plan_key: PaidPlanKey
  provider_product_id: string
  provider_price_id: string
  billing_interval: BillingInterval
  currency: string
  active: boolean
}

export function isProviderPriceMapping(value: unknown): value is ProviderPriceMapping {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return typeof row.provider === "string" && /^[a-z][a-z0-9_-]{0,79}$/.test(row.provider) &&
    (row.environment === "sandbox" || row.environment === "live") &&
    typeof row.id === "string" && row.id.length > 0 &&
    typeof row.plan_key === "string" && isPaidPlanKey(row.plan_key) &&
    typeof row.provider_product_id === "string" && row.provider_product_id.trim().length > 0 &&
    typeof row.provider_price_id === "string" && row.provider_price_id.trim().length > 0 &&
    typeof row.billing_interval === "string" && isBillingInterval(row.billing_interval) &&
    typeof row.currency === "string" && /^[A-Z]{3}$/.test(row.currency) &&
    typeof row.active === "boolean"
}

export function assertProviderPriceMapping(value: unknown): asserts value is ProviderPriceMapping {
  if (!isProviderPriceMapping(value)) throw new Error("Billing provider price mapping is invalid.")
}

async function isActivePlan(supabase: ReturnType<typeof createServiceRoleClient>, planKey: string) {
  const { data, error } = await supabase.from("plans").select("key, active").eq("key", planKey).maybeSingle()
  if (error) throw new Error(error.message)
  return data?.active === true
}

export async function getActiveProviderPrice(
  planKey: PaidPlanKey,
  provider: BillingProviderName,
  environment: BillingProviderEnvironment,
  billingInterval: BillingInterval = "month",
  currency = "USD",
) {
  const supabase = createServiceRoleClient()
  if (!(await isActivePlan(supabase, planKey))) return null
  const { data, error } = await supabase
    .from("billing_provider_prices")
    .select("id, provider, environment, plan_key, provider_product_id, provider_price_id, billing_interval, currency, active")
    .eq("provider", provider)
    .eq("environment", environment)
    .eq("plan_key", planKey)
    .eq("billing_interval", billingInterval)
    .eq("currency", currency)
    .eq("active", true)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) return null
  if (!isProviderPriceMapping(data)) throw new Error("Billing provider price mapping is invalid.")
  return data
}

export async function getProviderPriceByProviderId(provider: BillingProviderName, providerPriceId: string, environment: BillingProviderEnvironment, activeOnly = true) {
  const supabase = createServiceRoleClient()
  let query = supabase
    .from("billing_provider_prices")
    .select("id, provider, environment, plan_key, provider_product_id, provider_price_id, billing_interval, currency, active")
    .eq("provider", provider)
    .eq("environment", environment)
    .eq("provider_price_id", providerPriceId)
  if (activeOnly) query = query.eq("active", true)
  const { data, error } = await query.maybeSingle()

  if (error) throw new Error(error.message)
  if (!data || !isProviderPriceMapping(data)) return null
  if (activeOnly && !(await isActivePlan(supabase, data.plan_key))) return null
  return data
}

export async function getActiveProviderPriceByProviderId(provider: BillingProviderName, providerPriceId: string, environment: BillingProviderEnvironment) {
  return getProviderPriceByProviderId(provider, providerPriceId, environment, true)
}

export function planIsPaid(planKey: PlanKey | string): planKey is PaidPlanKey {
  return isPaidPlanKey(planKey)
}
