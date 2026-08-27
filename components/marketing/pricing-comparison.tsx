"use client"

import { useState } from "react"
import { MARKETING_COMPARISON_SECTIONS, orderMarketingPlans, type MarketingComparisonRow, type MarketingPlan } from "@/lib/marketing/plan-catalog"
import { useLanguage } from "@/context/language-context"
import type { TranslationKey } from "@/i18n"

const sectionLabels: Record<string, TranslationKey> = {
  reservations: "marketing.comparisonCategoryReservations",
  restaurantTeam: "marketing.comparisonCategoryRestaurantTeam",
  guestExperience: "marketing.comparisonCategoryGuestExperience",
  brandingDomains: "marketing.comparisonCategoryBrandingDomains",
  analyticsReports: "marketing.comparisonCategoryAnalyticsReports",
  notifications: "marketing.comparisonCategoryNotifications",
  integrations: "marketing.comparisonCategoryIntegrations",
  aiAgents: "marketing.comparisonCategoryAiAgents",
  support: "marketing.comparisonCategorySupport",
}

const rowLabels: Record<string, TranslationKey> = {
  restaurants: "marketing.comparisonRestaurants",
  users: "marketing.comparisonUsers",
  reservationsPerMonth: "marketing.comparisonReservationsPerMonth",
  reservationHistory: "marketing.comparisonReservationHistory",
  multiRestaurant: "marketing.featureMultiRestaurant",
  hostedPage: "marketing.featureHostedPage",
  guestHistory: "marketing.featureGuestHistory",
  customDomain: "marketing.featureCustomDomain",
  removeBranding: "marketing.featureRemoveBranding",
  customPWA: "marketing.featureCustomPwa",
  basicAnalytics: "marketing.featureAnalytics",
  csvExport: "marketing.featureCsv",
  advancedReports: "marketing.featureAdvancedReports",
  emailNotifications: "marketing.featureEmailNotifications",
  pushNotifications: "marketing.featurePush",
  automatedNotifications: "marketing.featureAutomatedNotifications",
  bookingChannels: "marketing.comparisonBookingChannels",
  publicAgentSurfaces: "marketing.comparisonPublicAgentSurfaces",
  docsAndGuidance: "marketing.comparisonDocsAndGuidance",
}

function formatLimit(plan: MarketingPlan, limit: "restaurants" | "users" | "reservationsPerPeriod" | "historyDays", getTranslation: (key: TranslationKey, replacements?: Record<string, string>) => string) {
  if (limit === "restaurants") return String(plan.restaurantLimit)
  if (limit === "users") return String(plan.userLimit)
  if (limit === "reservationsPerPeriod") return plan.reservationLimit === null ? getTranslation("marketing.unlimited") : String(plan.reservationLimit)
  if (plan.historyDays === null) return getTranslation("marketing.unlimited")
  if (plan.historyDays === 365) return `1 ${getTranslation("marketing.year")}`
  return `${plan.historyDays} ${getTranslation("marketing.days")}`
}

function comparisonValue(plan: MarketingPlan, row: MarketingComparisonRow, getTranslation: (key: TranslationKey, replacements?: Record<string, string>) => string) {
  if (row.kind === "limit") return { value: formatLimit(plan, row.limit, getTranslation), included: true }
  if (row.kind === "feature") return { value: getTranslation(plan.features[row.feature] ? "marketing.included" : "marketing.notIncluded"), included: plan.features[row.feature] === true }
  return { value: getTranslation("marketing.availableOnEveryPlan"), included: true }
}

export function PricingComparison({ plans }: { plans: MarketingPlan[] }) {
  const { getTranslation } = useLanguage()
  const orderedPlans = orderMarketingPlans(plans)
  const [selectedPlanKey, setSelectedPlanKey] = useState(orderedPlans[0]?.key || "pro")
  const selectedPlan = orderedPlans.find((plan) => plan.key === selectedPlanKey) || orderedPlans[0]

  if (!selectedPlan) return null

  return (
    <section className="marketing-comparison-section marketing-pricing-modern-comparison" id="feature-comparison" aria-labelledby="marketing-comparison-title">
      <div className="marketing-container">
        <div className="marketing-section-heading marketing-section-heading-centered marketing-comparison-heading">
          <p className="marketing-eyebrow">{getTranslation("marketing.comparisonEyebrow")}</p>
          <h2 id="marketing-comparison-title">{getTranslation("marketing.comparisonHeading")}</h2>
          <p>{getTranslation("marketing.comparisonDescription")}</p>
        </div>

        <div className="marketing-comparison-desktop" aria-label={getTranslation("marketing.comparisonHeading")}>
          {MARKETING_COMPARISON_SECTIONS.map((section) => <section className="marketing-comparison-category" key={section.key} aria-labelledby={`comparison-category-${section.key}`}>
            <div className="marketing-comparison-category-inner">
              <div className="marketing-comparison-category-heading">
                <h3 id={`comparison-category-${section.key}`}>{getTranslation(sectionLabels[section.key])}</h3>
                {orderedPlans.map((plan) => <strong className={plan.key === "pro" ? "marketing-comparison-pro" : ""} key={plan.key}>{plan.name}</strong>)}
              </div>
              {section.rows.map((row) => <div className="marketing-comparison-row" key={row.key}>
                <span className="marketing-comparison-row-label">{getTranslation(rowLabels[row.key])}</span>
                {orderedPlans.map((plan) => {
                  const result = comparisonValue(plan, row, getTranslation)
                  return <span className={`marketing-comparison-value${result.included ? " marketing-comparison-value-included" : " marketing-comparison-value-not-included"}`} key={plan.key}>{result.value}</span>
                })}
              </div>)}
            </div>
          </section>)}
        </div>

        <div className="marketing-comparison-mobile">
          <div className="marketing-comparison-plan-selector" role="tablist" aria-label={getTranslation("marketing.comparisonSelectPlan")}>
            {orderedPlans.map((plan) => <button key={plan.key} type="button" role="tab" aria-selected={selectedPlan.key === plan.key} className={selectedPlan.key === plan.key ? "marketing-comparison-plan-selected" : ""} onClick={() => setSelectedPlanKey(plan.key)}>{plan.name}</button>)}
          </div>
          <p className="marketing-comparison-selected-plan">{selectedPlan.name} · {selectedPlan.price} {getTranslation("marketing.perMonth")}</p>
          <div className="marketing-comparison-accordions">
            {MARKETING_COMPARISON_SECTIONS.map((section, index) => <details key={section.key} open={index === 0}>
              <summary><span>{getTranslation(sectionLabels[section.key])}</span><small>{getTranslation("marketing.comparisonOpenSection")}</small></summary>
              <div className="marketing-comparison-mobile-rows">
                {section.rows.map((row) => {
                  const result = comparisonValue(selectedPlan, row, getTranslation)
                  return <div className="marketing-comparison-mobile-row" key={row.key}><span>{getTranslation(rowLabels[row.key])}</span><strong className={result.included ? "marketing-comparison-value-included" : "marketing-comparison-value-not-included"}>{result.value}</strong></div>
                })}
              </div>
            </details>)}
          </div>
        </div>
      </div>
    </section>
  )
}
