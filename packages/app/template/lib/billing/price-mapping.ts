import "server-only"

import type { PlanKey } from "@/lib/entitlements"
import { createServiceRoleClient } from "@/lib/supabase"
import type { BillingEnvironment } from "./paddle-client"

export const PAID_PLAN_KEYS = ["starter", "pro", "business"] as const
export type PaidPlanKey = (typeof PAID_PLAN_KEYS)[number]
export const BILLING_INTERVALS = ["month", "year"] as const
export type BillingInterval = (typeof BILLING_INTERVALS)[number]

export function isBillingInterval(value: string): value is BillingInterval {
  return (BILLING_INTERVALS as readonly string[]).includes(value)
}

export function isPaidPlanKey(value: string): value is PaidPlanKey {
  return (PAID_PLAN_KEYS as readonly string[]).includes(value)
}

export type ProviderPriceMapping = {
  id: string
  provider: string
  environment: BillingEnvironment
  plan_key: PaidPlanKey
  provider_product_id: string
  provider_price_id: string
  billing_interval: BillingInterval
  currency: string
  active: boolean
}

export async function getActivePaddlePrice(
  planKey: PaidPlanKey,
  environment: BillingEnvironment,
  billingInterval: BillingInterval = "month",
  currency = "USD",
) {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from("billing_provider_prices")
    .select("id, provider, environment, plan_key, provider_product_id, provider_price_id, billing_interval, currency, active")
    .eq("provider", "paddle")
    .eq("environment", environment)
    .eq("plan_key", planKey)
    .eq("billing_interval", billingInterval)
    .eq("currency", currency)
    .eq("active", true)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) return null
  return data as ProviderPriceMapping
}

export async function getPaddlePriceByProviderId(providerPriceId: string, environment: BillingEnvironment, activeOnly = true) {
  const supabase = createServiceRoleClient()
  let query = supabase
    .from("billing_provider_prices")
    .select("id, provider, environment, plan_key, provider_product_id, provider_price_id, billing_interval, currency, active")
    .eq("provider", "paddle")
    .eq("environment", environment)
    .eq("provider_price_id", providerPriceId)
  if (activeOnly) query = query.eq("active", true)
  const { data, error } = await query.maybeSingle()

  if (error) throw new Error(error.message)
  if (!data || !isPaidPlanKey(data.plan_key)) return null
  return data as ProviderPriceMapping
}

export async function getActivePaddlePriceByProviderId(providerPriceId: string, environment: BillingEnvironment) {
  return getPaddlePriceByProviderId(providerPriceId, environment, true)
}

export function planIsPaid(planKey: PlanKey | string): planKey is PaidPlanKey {
  return isPaidPlanKey(planKey)
}
