import "server-only"

import { unstable_cache } from "next/cache"
import { createServiceRoleClient } from "@/lib/supabase"
import { buildMarketingPlans, type MarketingPlan, type PublicPlanCatalogRow } from "@/lib/marketing/plan-catalog"

const loadMarketingPlansCached = unstable_cache(
  async (): Promise<MarketingPlan[]> => {
    const { data, error } = await createServiceRoleClient()
      .from("plans")
      .select("key, name, monthly_price_usd_cents, sort_order, restaurant_limit, user_limit, reservation_limit, history_days, features")
      .eq("active", true)
      .order("sort_order", { ascending: true })

    if (error) throw new Error(error.message)
    return buildMarketingPlans((data || []) as PublicPlanCatalogRow[])
  },
  ["reservevia-marketing-plans"],
  { revalidate: 300, tags: ["marketing-plans"] },
)

export function loadMarketingPlans(): Promise<MarketingPlan[]> {
  return loadMarketingPlansCached()
}
