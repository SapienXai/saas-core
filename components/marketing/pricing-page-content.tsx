"use client"

import { ArrowRight } from "lucide-react"
import { PricingGrid } from "@/components/marketing/pricing-grid"
import { PricingComparison } from "@/components/marketing/pricing-comparison"
import { MarketingLayout } from "@/components/marketing/marketing-layout"
import { getApplicationLink } from "@/lib/platform-urls"
import type { MarketingPlan } from "@/lib/marketing/plan-catalog"
import { useLanguage } from "@/context/language-context"
import type { PublicBillingPrice } from "@/lib/marketing/public-billing-prices"

export function PricingPageContent({ plans, billingPrices }: { plans: MarketingPlan[]; billingPrices: PublicBillingPrice[] }) {
  const { getTranslation } = useLanguage()

  return (
    <MarketingLayout>
      <main className="marketing-pricing-page marketing-pricing-modern">
        <section className="marketing-pricing-hero marketing-pricing-modern-hero">
          <div className="marketing-container marketing-pricing-hero-inner">
            <div className="marketing-section-heading marketing-section-heading-centered marketing-pricing-modern-heading">
              <p className="marketing-eyebrow">{getTranslation("marketing.pricingSimple")}</p>
              <h1>{getTranslation("marketing.pricingHeroTitle")}</h1>
              <p>{getTranslation("marketing.pricingHeroDescription")}</p>
            </div>
            <div className="marketing-pricing-trustline" aria-label={getTranslation("marketing.pricingBenefits")}>
              <span><i aria-hidden="true" /> {getTranslation("marketing.noCardStart")}</span>
              <span><i aria-hidden="true" /> {getTranslation("marketing.changeWhenNeeded")}</span>
            </div>
          </div>
        </section>
        <section className="marketing-section marketing-pricing-page-grid marketing-pricing-modern-grid-section">
          <div className="marketing-container">
            <div className="marketing-pricing-grid-heading">
              <div>
                <p className="marketing-eyebrow">{getTranslation("marketing.chooseStartingPoint")}</p>
                <h2>{getTranslation("marketing.pricingPath")}</h2>
              </div>
              <p>{getTranslation("marketing.pricingPathDescription")}</p>
            </div>
            <PricingGrid plans={plans} billingPrices={billingPrices} variant="detailed" />
          </div>
        </section>
        {plans.length > 0 && <PricingComparison plans={plans} />}
        <section className="marketing-pricing-bottom marketing-pricing-modern-bottom">
          <div className="marketing-container marketing-pricing-bottom-inner">
            <div><p className="marketing-eyebrow marketing-eyebrow-light">{getTranslation("marketing.readyWhen")}</p><h2>{getTranslation("marketing.startBookings")}</h2><p>{getTranslation("marketing.dataStays")}</p></div>
            <a href={getApplicationLink("/signup")} className="marketing-button marketing-button-primary">{getTranslation("marketing.startForFree")} <ArrowRight aria-hidden="true" /></a>
          </div>
        </section>
      </main>
    </MarketingLayout>
  )
}
