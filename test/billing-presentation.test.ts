import { describe, expect, it } from "vitest"
import { formatCurrentSubscriptionPrice, resolveCurrentSubscriptionPrice } from "../lib/billing/presentation"

describe("current subscription billing presentation", () => {
  const pricing = {
    month: { amount: 49, currency: "USD" },
    year: { amount: 490, currency: "USD" },
  }

  it("uses the provider's monthly amount for the current subscription", () => {
    const price = resolveCurrentSubscriptionPrice({ billingInterval: "month", billingCurrency: "USD", currentProviderPriceAmount: "4900", pricing })
    expect(price).toMatchObject({ amount: 49, currency: "USD", interval: "month", source: "provider" })
    expect(formatCurrentSubscriptionPrice(price, "en")).toContain("49")
  })

  it("uses the provider's yearly amount even when the browse toggle is independent", () => {
    const price = resolveCurrentSubscriptionPrice({ billingInterval: "year", billingCurrency: "USD", currentProviderPriceAmount: "49000", pricing })
    expect(price).toMatchObject({ amount: 490, currency: "USD", interval: "year", source: "provider" })
  })

  it("keeps the current interval and falls back to its catalog price during a pending target change", () => {
    const price = resolveCurrentSubscriptionPrice({ billingInterval: "month", billingCurrency: "USD", currentProviderPriceAmount: null, pricing })
    expect(price).toMatchObject({ amount: 49, currency: "USD", interval: "month", source: "catalog" })
  })
})
