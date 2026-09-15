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

  it("does not present catalog pricing as the current provider charge when the amount is unavailable", () => {
    const price = resolveCurrentSubscriptionPrice({ providerBacked: true, billingInterval: "month", billingCurrency: "USD", currentProviderPriceAmount: null, pricing })
    expect(price).toMatchObject({ amount: null, currency: "USD", interval: "month", source: "unavailable" })
    expect(formatCurrentSubscriptionPrice(price, "en")).toBeNull()
  })

  it("preserves intentional catalog semantics for non-provider subscriptions", () => {
    const price = resolveCurrentSubscriptionPrice({ providerBacked: false, billingInterval: "month", billingCurrency: "USD", currentProviderPriceAmount: null, pricing })
    expect(price).toMatchObject({ amount: 49, currency: "USD", interval: "month", source: "catalog" })
  })

  it("uses provider amounts for grandfathered custom prices and keeps browse selection independent", () => {
    const custom = resolveCurrentSubscriptionPrice({ providerBacked: true, billingInterval: "year", billingCurrency: "USD", currentProviderPriceAmount: "39000", pricing })
    expect(custom).toMatchObject({ amount: 390, currency: "USD", interval: "year", source: "provider" })
    const toggleIndependent = resolveCurrentSubscriptionPrice({ providerBacked: true, billingInterval: "month", billingCurrency: "USD", currentProviderPriceAmount: "39000", pricing })
    expect(toggleIndependent).toMatchObject({ amount: 390, currency: "USD", interval: "month", source: "provider" })
  })
})
