import type { Metadata } from "next"
import { PricingPageContent } from "@/components/marketing/pricing-page-content"
import { loadMarketingPlans } from "@/lib/marketing/public-plans"
import { requireMarketingHost } from "@/lib/marketing/host"
import { getPlatformUrl } from "@/lib/platform-urls"
import type { MarketingPlan } from "@/lib/marketing/plan-catalog"
import { loadPublicBillingPrices } from "@/lib/marketing/public-billing-prices"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Pricing — Reservevia",
  description: "Start free with a restaurant booking page, then add domains, team access, history, and multi-restaurant management as you grow.",
  alternates: { canonical: getPlatformUrl("/pricing") },
  openGraph: {
    title: "Pricing — Reservevia",
    description: "Simple monthly plans for restaurants taking reservations online.",
    url: getPlatformUrl("/pricing"),
    siteName: "Reservevia",
    type: "website",
  },
}

export default async function PricingPage() {
  await requireMarketingHost()
  let plans: MarketingPlan[] = []
  try {
    plans = await loadMarketingPlans()
  } catch (error) {
    console.error("Pricing catalog could not be loaded:", error)
  }

  const billingPrices = await loadPublicBillingPrices()
  return <PricingPageContent plans={plans} billingPrices={billingPrices} />
}
