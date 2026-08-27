"use client"

import { Check } from "lucide-react"
import { useState } from "react"
import { getApplicationLink } from "@/lib/platform-urls"
import { trackMarketingEvent } from "@/lib/marketing/analytics"
import type { FeatureKey } from "@/lib/entitlements"
import { getCompactPlanHighlights, orderMarketingPlans, type MarketingHighlightDefinition, type MarketingPlan } from "@/lib/marketing/plan-catalog"
import { useLanguage } from "@/context/language-context"
import type { TranslationKey } from "@/i18n"
import type { PublicBillingPrice } from "@/lib/marketing/public-billing-prices"

type PricingGridProps = {
  plans: MarketingPlan[]
  billingPrices?: PublicBillingPrice[]
  variant?: "compact" | "detailed"
}

const planCopyKeys: Record<MarketingPlan["key"], { target: TranslationKey; description: TranslationKey }> = {
  free: { target: "marketing.planFreeTarget", description: "marketing.planFreeDescription" },
  starter: { target: "marketing.planStarterTarget", description: "marketing.planStarterDescription" },
  pro: { target: "marketing.planProTarget", description: "marketing.planProDescription" },
  business: { target: "marketing.planBusinessTarget", description: "marketing.planBusinessDescription" },
}

const featureTranslationKeys: Record<FeatureKey, TranslationKey> = {
  hostedRestaurantPage: "marketing.featureHostedPage",
  emailNotifications: "marketing.featureEmailNotifications",
  removeReserveviaBranding: "marketing.featureRemoveBranding",
  customDomain: "marketing.featureCustomDomain",
  basicAnalytics: "marketing.featureAnalytics",
  csvExport: "marketing.featureCsv",
  guestHistory: "marketing.featureGuestHistory",
  automatedNotifications: "marketing.featureAutomatedNotifications",
  advancedReports: "marketing.featureAdvancedReports",
  customPWA: "marketing.featureCustomPwa",
  pushNotifications: "marketing.featurePush",
  multiRestaurant: "marketing.featureMultiRestaurant",
}

function planLimitText(plan: MarketingPlan, getTranslation: (key: TranslationKey, replacements?: Record<string, string>) => string) {
  const restaurantLabel = plan.restaurantLimit === 1 ? getTranslation("marketing.restaurant") : getTranslation("marketing.restaurants")
  const userLabel = plan.userLimit === 1 ? getTranslation("marketing.user") : getTranslation("marketing.users")
  const historyLabel = plan.historyDays === null
    ? getTranslation("marketing.unlimited")
    : plan.historyDays === 365
      ? `1 ${getTranslation("marketing.year")}`
      : `${plan.historyDays} ${getTranslation("marketing.days")}`

  return [
    `${plan.restaurantLimit} ${restaurantLabel}`,
    `${plan.userLimit} ${userLabel}`,
    getTranslation("marketing.reservationsPerMonth", { limit: plan.reservationLimit === null ? getTranslation("marketing.unlimited") : String(plan.reservationLimit) }),
    `${historyLabel} ${getTranslation("marketing.history")}`,
  ]
}

function compactHighlightText(
  plan: MarketingPlan,
  highlight: MarketingHighlightDefinition,
  getTranslation: (key: TranslationKey, replacements?: Record<string, string>) => string,
) {
  if (highlight.kind === "feature") return getTranslation(featureTranslationKeys[highlight.key])
  if (highlight.key === "restaurants") {
    const label = plan.restaurantLimit === 1 ? getTranslation("marketing.restaurant") : getTranslation("marketing.restaurants")
    return `${plan.restaurantLimit} ${label}`
  }
  if (highlight.key === "users") {
    const label = plan.userLimit === 1 ? getTranslation("marketing.user") : getTranslation("marketing.users")
    return `${plan.userLimit} ${label}`
  }
  return getTranslation("marketing.reservationsPerMonth", {
    limit: plan.reservationLimit === null ? getTranslation("marketing.unlimited") : String(plan.reservationLimit),
  })
}

function parseMinorAmount(value: string | number | null | undefined) {
  const amount = Number(value)
  return Number.isFinite(amount) && amount >= 0 ? amount : null
}

function formatCurrencyAmount(amountInMinorUnits: number, currency: string) {
  const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency })
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2
  return formatter.format(amountInMinorUnits / (10 ** fractionDigits))
}

export function PricingGrid({ plans, billingPrices = [], variant = "detailed" }: PricingGridProps) {
  const { getTranslation } = useLanguage()
  const [interval, setInterval] = useState<"month" | "year">("month")

  if (!plans.length) {
    return <p className="marketing-pricing-unavailable">{getTranslation("marketing.pricingUnavailable")}</p>
  }

  const orderedPlans = orderMarketingPlans(plans)
  const displayInterval = variant === "compact" ? "month" : interval
  const hasAnnualPrices = billingPrices.some((price) => price.interval === "year" && price.amount)

  return (
    <div className={`marketing-pricing-grid-surface marketing-pricing-grid-${variant}`} data-pricing-variant={variant}>
      {variant === "detailed" && <div className="marketing-pricing-grid-controls">
        <div className="marketing-pricing-billing-toggle" data-active={interval} role="group" aria-label={getTranslation("marketing.billingCycle")}>
          {(["month", "year"] as const).map((candidate) => <button key={candidate} type="button" aria-pressed={interval === candidate} disabled={candidate === "year" && !hasAnnualPrices} onClick={() => setInterval(candidate)} className={`marketing-pricing-billing-option${interval === candidate ? " marketing-pricing-billing-option-active" : ""}`}>{candidate === "month" ? getTranslation("marketing.monthly") : getTranslation("marketing.annual")}</button>)}
        </div>
      </div>}
      <div className="marketing-pricing-grid">
        {orderedPlans.map((plan) => {
          const planCopy = planCopyKeys[plan.key]
          const configuredPrice = billingPrices.find((price) => price.planKey === plan.key && price.interval === displayInterval)
          const configuredMonthlyPrice = billingPrices.find((price) => price.planKey === plan.key && price.interval === "month")
          const configuredAnnualPrice = billingPrices.find((price) => price.planKey === plan.key && price.interval === "year")
          const currentPriceAmount = parseMinorAmount(configuredPrice?.amount)
          const currentPriceCurrency = configuredPrice?.currency
          const displayPrice = currentPriceAmount !== null && currentPriceCurrency
            ? formatCurrencyAmount(currentPriceAmount, currentPriceCurrency)
            : plan.price
          const annualPriceAmount = parseMinorAmount(configuredAnnualPrice?.amount)
          const annualPriceCurrency = configuredAnnualPrice?.currency
          const monthlyComparisonAmount = annualPriceCurrency && configuredMonthlyPrice?.currency === annualPriceCurrency && configuredMonthlyPrice.amount
            ? parseMinorAmount(configuredMonthlyPrice.amount)
            : annualPriceCurrency === "USD" ? plan.priceCents : null
          const hasAnnualPrice = displayInterval === "year" && annualPriceAmount !== null && Boolean(annualPriceCurrency)
          const annualListPriceAmount = monthlyComparisonAmount !== null ? monthlyComparisonAmount * 12 : null
          const annualSavingsPercent = hasAnnualPrice && monthlyComparisonAmount !== null && monthlyComparisonAmount > 0
            ? Math.max(0, Math.round(((monthlyComparisonAmount * 12) - annualPriceAmount) / (monthlyComparisonAmount * 12) * 100))
            : 0
          const annualListPriceDisplay = hasAnnualPrice && annualListPriceAmount !== null && annualPriceCurrency
            ? formatCurrencyAmount(annualListPriceAmount, annualPriceCurrency)
            : null
          const billingLabel = displayInterval === "year" ? getTranslation("marketing.perYear") : getTranslation("marketing.perMonth")
          const compactHighlights = getCompactPlanHighlights(plan)
          const detailedFeatures = plan.featureKeys.map((feature) => getTranslation(featureTranslationKeys[feature]))
          const isConfigured = plan.key === "free" || Boolean(configuredPrice?.amount)
          return (
            <article key={plan.key} className={`marketing-price-card marketing-price-card-${plan.key}`} data-plan={plan.key}>
              <div className="marketing-price-card-top">
                <div>
                  <p className="marketing-price-name">{plan.name}</p>
                  <p className="marketing-price-target">{getTranslation(planCopy.target)}</p>
                </div>
                {variant === "detailed" && plan.key === "pro" && <span className="marketing-price-note">{getTranslation("marketing.growNote")}</span>}
              </div>
              <div className={`marketing-price-value${hasAnnualPrice && annualListPriceDisplay ? " marketing-price-value-annual" : ""}`}>
                {annualListPriceDisplay && <span className="marketing-price-compare"><del>{annualListPriceDisplay}</del><small>{getTranslation("marketing.perYear")}</small></span>}
                <span className="marketing-price-current"><strong>{displayPrice}</strong><span>{billingLabel}</span></span>
              </div>
              {annualSavingsPercent > 0 && <span className="marketing-price-savings">{getTranslation("marketing.annualSavings", { percent: String(annualSavingsPercent) })}</span>}
              {variant === "detailed" && <p className="marketing-price-description">{getTranslation(planCopy.description)}</p>}

              {variant === "compact" ? <ul className="marketing-price-highlights">
                {compactHighlights.slice(0, 5).map((highlight) => <li key={`${highlight.kind}-${highlight.key}`}><Check aria-hidden="true" />{compactHighlightText(plan, highlight, getTranslation)}</li>)}
              </ul> : <>
                <a aria-disabled={!isConfigured} href={getApplicationLink(plan.key === "free" ? "/signup" : `/signup?plan=${encodeURIComponent(plan.key)}&interval=${displayInterval}`)} onClick={() => { if (isConfigured) { trackMarketingEvent("pricing_plan_click", { plan: plan.key, source: "pricing" }); trackMarketingEvent("signup_started", { plan: plan.key, source: "pricing" }) } }} className={`marketing-button ${plan.key === "pro" ? "marketing-button-dark" : "marketing-button-light"}`}>
                  {plan.key === "free" ? getTranslation("marketing.getStartedFree") : getTranslation("marketing.choosePlan", { plan: plan.name })}
                </a>
                <ul className="marketing-price-limits">
                  {planLimitText(plan, getTranslation).map((limit) => <li key={limit}><Check aria-hidden="true" />{limit}</li>)}
                </ul>
                <ul className="marketing-price-features">
                  {detailedFeatures.map((feature) => <li key={feature}>{feature}</li>)}
                </ul>
                <p className="marketing-price-footnote">{getTranslation(displayInterval === "year" ? "marketing.annualFootnote" : "marketing.monthlyFootnote")}</p>
              </>}

              {variant === "compact" && <a aria-disabled={!isConfigured} href={getApplicationLink(plan.key === "free" ? "/signup" : `/signup?plan=${encodeURIComponent(plan.key)}&interval=month`)} onClick={() => { if (isConfigured) { trackMarketingEvent("pricing_plan_click", { plan: plan.key, source: "pricing" }); trackMarketingEvent("signup_started", { plan: plan.key, source: "pricing" }) } }} className={`marketing-button marketing-price-compact-cta ${plan.key === "pro" ? "marketing-button-dark" : "marketing-button-light"}`}>
                {plan.key === "free" ? getTranslation("marketing.getStartedFree") : getTranslation("marketing.choosePlan", { plan: plan.name })}
              </a>}
            </article>
          )
        })}
      </div>
    </div>
  )
}
