import { describe, expect, it } from "vitest"
import { buildMarketingPlans, formatHistory, formatLimit, formatPrice, getCompactPlanHighlights, MARKETING_COMPARISON_SECTIONS } from "@/lib/marketing/plan-catalog"
import { isMarketingHostname } from "@/lib/marketing/host"
import { getApplicationUrl } from "@/lib/platform-urls"

function catalogRow(overrides: Partial<Parameters<typeof buildMarketingPlans>[0][number]> = {}) {
  return {
    key: "starter",
    name: "Starter",
    monthly_price_usd_cents: 1900,
    sort_order: 2,
    restaurant_limit: 1,
    user_limit: 3,
    reservation_limit: 500,
    history_days: 365,
    features: { hostedRestaurantPage: true, customDomain: true, emailNotifications: true },
    ...overrides,
  }
}

describe("Reservevia marketing catalog", () => {
  it("formats database values without introducing marketing-specific numeric rules", () => {
    const plans = buildMarketingPlans([
      catalogRow({ key: "free", name: "Free", monthly_price_usd_cents: 0, sort_order: 1, user_limit: 1, reservation_limit: 100, history_days: 30, features: { hostedRestaurantPage: true } }),
      catalogRow({ monthly_price_usd_cents: 2715, restaurant_limit: 4, user_limit: 7, reservation_limit: 812, history_days: 418 }),
    ])

    expect(plans[0]).toMatchObject({ key: "free", price: "$0", restaurantLimit: 1, userLimit: 1, reservationLimit: 100, historyLabel: "30 days" })
    expect(plans[1]).toMatchObject({ price: "$27", restaurantLimit: 4, userLimit: 7, reservationLimit: 812, historyLabel: "418 days" })
  })

  it("reflects entitlement feature flags in public feature labels", () => {
    const plans = buildMarketingPlans([
      catalogRow({ key: "free", name: "Free", sort_order: 1, features: { hostedRestaurantPage: true, customDomain: false } }),
      catalogRow({ key: "starter", name: "Starter", sort_order: 2, features: { customDomain: true } }),
      catalogRow({ key: "pro", name: "Pro", sort_order: 3, features: { customPWA: true, pushNotifications: true } }),
      catalogRow({ key: "business", name: "Business", sort_order: 4, features: { multiRestaurant: true } }),
    ])

    expect(plans.find((plan) => plan.key === "free")?.features.customDomain).toBe(false)
    expect(plans.find((plan) => plan.key === "starter")?.featureLabels).toContain("Custom booking domain")
    expect(plans.find((plan) => plan.key === "pro")?.featureLabels).toEqual(["Branded management app", "Push notifications"])
    expect(plans.find((plan) => plan.key === "business")?.featureLabels).toEqual(["Multi-restaurant management"])
  })

  it("surfaces push notifications for every pricing package", () => {
    const plans = buildMarketingPlans([
      catalogRow({ key: "free", name: "Free", sort_order: 1, features: { pushNotifications: true } }),
      catalogRow({ key: "starter", name: "Starter", sort_order: 2, features: { pushNotifications: true } }),
      catalogRow({ key: "pro", name: "Pro", sort_order: 3, features: { pushNotifications: true } }),
      catalogRow({ key: "business", name: "Business", sort_order: 4, features: { pushNotifications: true } }),
    ])

    expect(plans).toHaveLength(4)
    expect(plans.every((plan) => plan.features.pushNotifications === true)).toBe(true)
    expect(plans.every((plan) => plan.featureLabels.includes("Push notifications"))).toBe(true)
  })

  it("keeps homepage highlights compact and entitlement-aware", () => {
    const [pro] = buildMarketingPlans([catalogRow({ key: "pro", name: "Pro", sort_order: 1, features: { advancedReports: true, customPWA: true, customDomain: false } })])
    const highlights = getCompactPlanHighlights(pro)

    expect(highlights).toHaveLength(5)
    expect(highlights.filter((highlight) => highlight.kind === "feature").map((highlight) => highlight.key)).toEqual(["advancedReports", "customPWA"])
    const free = buildMarketingPlans([catalogRow({ key: "free", name: "Free", sort_order: 1, features: { emailNotifications: true, pushNotifications: false } })])[0]
    expect(getCompactPlanHighlights(free).map((highlight) => highlight.kind === "feature" ? highlight.key : highlight.key)).toContain("emailNotifications")
    expect(getCompactPlanHighlights(free)).not.toContainEqual({ kind: "feature", key: "pushNotifications" })
  })

  it("keeps detailed comparison categories tied to plan limits and feature keys", () => {
    expect(MARKETING_COMPARISON_SECTIONS.map((section) => section.key)).toEqual([
      "reservations",
      "restaurantTeam",
      "guestExperience",
      "brandingDomains",
      "analyticsReports",
      "notifications",
      "integrations",
      "aiAgents",
      "support",
    ])
    expect(MARKETING_COMPARISON_SECTIONS.flatMap((section) => section.rows).some((row) => row.kind === "feature" && row.feature === "customDomain")).toBe(true)
  })

  it("formats customer-facing limits and prices", () => {
    expect(formatPrice(0)).toBe("$0")
    expect(formatPrice(4900)).toBe("$49")
    expect(formatLimit(null)).toBe("Unlimited")
    expect(formatHistory(365)).toBe("1 year")
  })

  it("keeps platform marketing separate from app and tenant hosts", () => {
    expect(isMarketingHostname("reservevia.com")).toBe(true)
    expect(isMarketingHostname("localhost:3000")).toBe(true)
    expect(isMarketingHostname("felix-beach.reservevia.com")).toBe(false)
    expect(isMarketingHostname("app.reservevia.com")).toBe(false)
    expect(isMarketingHostname("booking.example.com")).toBe(false)
  })

  it("routes anonymous CTAs to the application origin", () => {
    expect(getApplicationUrl("/signup", { nodeEnv: "development", siteUrl: "http://localhost:3000" })).toBe("http://localhost:3000/signup")
    expect(getApplicationUrl("/login", { nodeEnv: "production", appDomain: "app.reservevia.com" })).toBe("https://app.reservevia.com/login")
  })
})
