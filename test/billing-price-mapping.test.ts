import { describe, expect, it } from "vitest"
import { isProviderPriceMapping } from "../lib/billing/price-mapping"

const mapping = {
  id: "mapping-1",
  environment: "sandbox",
  plan_key: "starter",
  provider_product_id: "prod_test_starter",
  provider_price_id: "price_test_starter_month",
  billing_interval: "month",
  currency: "USD",
  active: true,
}

describe("provider price mappings", () => {
  it("accepts syntactically valid provider names through the neutral contract", () => {
    expect(isProviderPriceMapping({ ...mapping, provider: "stripe" })).toBe(true)
    expect(isProviderPriceMapping({ ...mapping, provider: "venue-payments" })).toBe(true)
  })

  it("rejects malformed provider names and mapping details", () => {
    expect(isProviderPriceMapping({ ...mapping, provider: "Invalid Provider" })).toBe(false)
    expect(isProviderPriceMapping({ ...mapping, provider: "stripe", billing_interval: "week" })).toBe(false)
    expect(isProviderPriceMapping({ ...mapping, provider: "stripe", currency: "usd" })).toBe(false)
  })
})
