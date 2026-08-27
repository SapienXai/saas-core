import "server-only"

import { getBillingEnvironment, getPaddleServerClient } from "@/lib/billing/paddle-client"
import { createServiceRoleClient } from "@/lib/supabase"

export type PublicBillingPrice = {
  planKey: string
  interval: string
  currency: string
  amount: string | null
}

export async function loadPublicBillingPrices(): Promise<PublicBillingPrice[]> {
  try {
    const environment = getBillingEnvironment()
    const supabase = createServiceRoleClient()
    const { data, error } = await supabase
      .from("billing_provider_prices")
      .select("plan_key, billing_interval, currency, provider_price_id")
      .eq("provider", "paddle")
      .eq("environment", environment)
      .eq("active", true)
    if (error) throw new Error(error.message)
    const paddle = getPaddleServerClient()
    return Promise.all((data || []).map(async (row) => {
      try {
        const price = await paddle.prices.get(row.provider_price_id)
        return { planKey: row.plan_key, interval: row.billing_interval, currency: row.currency, amount: price.unitPrice.amount }
      } catch {
        return { planKey: row.plan_key, interval: row.billing_interval, currency: row.currency, amount: null }
      }
    }))
  } catch {
    return []
  }
}
