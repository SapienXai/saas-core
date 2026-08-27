"use client"

import Image from "next/image"
import Link from "next/link"
import dynamic from "next/dynamic"
import { useEffect, useRef, type MouseEvent } from "react"
import { ArrowRight, ArrowUpRight, BarChart3, BookOpen, Bot, Braces, Check, Globe2, Layers3, Share2, Smartphone, UsersRound } from "lucide-react"
import { getApplicationLink } from "@/lib/platform-urls"
import { trackMarketingEvent } from "@/lib/marketing/analytics"
import type { MarketingPlan } from "@/lib/marketing/plan-catalog"
import type { PublicBillingPrice } from "@/lib/marketing/public-billing-prices"
import type { TranslationKey } from "@/i18n"
import { MarketingLayout } from "@/components/marketing/marketing-layout"
import { ProductShowcase } from "@/components/marketing/product-showcase"
import { useLanguage } from "@/context/language-context"

const HowItWorksSteps = dynamic(() => import("@/components/marketing/how-it-works-steps").then((module) => module.HowItWorksSteps))
const PricingGrid = dynamic(() => import("@/components/marketing/pricing-grid").then((module) => module.PricingGrid))

const HERO_CHANNEL_CATEGORIES = [
  { key: "marketing.heroChannelWebsite", Icon: Globe2 },
  { key: "marketing.heroChannelSocial", Icon: Share2 },
  { key: "marketing.heroChannelPlatforms", Icon: Layers3 },
  { key: "marketing.heroChannelAgents", Icon: Bot },
] as const

type OutcomeVisualKind = "bookings" | "operations" | "guests"

function OutcomeVisual({ kind, alt }: { kind: OutcomeVisualKind; alt: string }) {
  if (kind === "bookings") {
    return (
      <div className="marketing-outcome-visual marketing-outcome-visual-bookings" aria-label={alt}>
        <div className="marketing-outcome-device marketing-outcome-device-directory">
          <Image src="/assets/screenshots/8.webp" alt="" fill sizes="(min-width: 900px) 24vw, 82vw" />
        </div>
        <div className="marketing-outcome-device marketing-outcome-device-profile">
          <Image src="/assets/screenshots/7.webp" alt="" fill sizes="(min-width: 900px) 13vw, 40vw" />
        </div>
      </div>
    )
  }

  return (
    <div className={`marketing-outcome-visual marketing-outcome-visual-${kind}`} aria-label={alt}>
      <Image
        src={kind === "operations" ? "/assets/screenshots/5-valid.webp" : "/assets/screenshots/4-valid.webp"}
        alt=""
        fill
        sizes="(min-width: 900px) 30vw, 92vw"
      />
    </div>
  )
}

function GuestBookingVisual({ getTranslation }: { getTranslation: (key: TranslationKey, replacements?: Record<string, string>) => string }) {
  return (
    <div className="marketing-page-showcase" aria-label={getTranslation("marketing.showcaseLabel")}>
      <div className="marketing-page-device marketing-page-device-directory">
        <div className="marketing-page-device-bar"><span /><span /><span /><b>reservevia.com/restaurants</b></div>
        <div className="marketing-page-device-screen">
          <Image src="/assets/screenshots/9.webp" alt={getTranslation("marketing.restaurantDirectory")} fill sizes="(min-width: 900px) 34vw, 78vw" />
        </div>
      </div>
      <div className="marketing-page-device marketing-page-device-profile">
        <div className="marketing-page-device-screen">
          <Image src="/assets/screenshots/7.webp" alt={getTranslation("marketing.restaurantProfile")} fill sizes="(min-width: 900px) 16vw, 42vw" />
        </div>
      </div>
      <div className="marketing-page-device marketing-page-device-profile-alt">
        <div className="marketing-page-device-screen">
          <Image src="/assets/screenshots/8.webp" alt={getTranslation("marketing.mobileBookingPage")} fill sizes="(min-width: 900px) 14vw, 34vw" />
        </div>
      </div>
    </div>
  )
}

export function MarketingHome({ plans, billingPrices }: { plans: MarketingPlan[]; billingPrices: PublicBillingPrice[] }) {
  const { getTranslation } = useLanguage()
  const pageViewTrackedRef = useRef(false)

  function handleHowItWorksClick(event: MouseEvent<HTMLAnchorElement>) {
    const section = document.getElementById("how-it-works")
    if (!section) return
    event.preventDefault()
    section.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" })
    window.history.replaceState(null, "", `${window.location.pathname}#how-it-works`)
  }

  useEffect(() => {
    if (pageViewTrackedRef.current) return
    pageViewTrackedRef.current = true
    trackMarketingEvent("marketing_page_view", { source: "homepage" })
  }, [])

  const localizedSteps = [
    { number: "01", title: getTranslation("marketing.createRestaurant"), text: getTranslation("marketing.createRestaurantDescription") },
    { number: "02", title: getTranslation("marketing.publishPage"), text: getTranslation("marketing.publishPageDescription") },
    { number: "03", title: getTranslation("marketing.manageReservations"), text: getTranslation("marketing.manageReservationsDescription") },
  ]
  const localizedFaqs = [
    [getTranslation("marketing.faq1q"), getTranslation("marketing.faq1a")],
    [getTranslation("marketing.faq2q"), getTranslation("marketing.faq2a")],
    [getTranslation("marketing.faq3q"), getTranslation("marketing.faq3a")],
    [getTranslation("marketing.faq4q"), getTranslation("marketing.faq4a")],
    [getTranslation("marketing.faq5q"), getTranslation("marketing.faq5a")],
    [getTranslation("marketing.faq6q"), getTranslation("marketing.faq6a")],
    [getTranslation("marketing.faq7q"), getTranslation("marketing.faq7a")],
    [getTranslation("marketing.faq8q"), getTranslation("marketing.faq8a")],
  ]

  const capabilities: Array<{ key: TranslationKey; description: TranslationKey; Icon: typeof Globe2 }> = [
    { key: "marketing.featureCustomDomain", description: "marketing.capabilityCustomDomainDescription", Icon: Globe2 },
    { key: "marketing.teamAccess", description: "marketing.capabilityTeamAccessDescription", Icon: UsersRound },
    { key: "marketing.featureGuestHistory", description: "marketing.capabilityGuestHistoryDescription", Icon: BookOpen },
    { key: "marketing.featureAdvancedReports", description: "marketing.capabilityReportsDescription", Icon: BarChart3 },
    { key: "marketing.featureMultiRestaurant", description: "marketing.capabilityLocationsDescription", Icon: Layers3 },
    { key: "marketing.featureCustomPwa", description: "marketing.capabilityBrandedDescription", Icon: Smartphone },
  ]

  return (
    <MarketingLayout>
      <main className="marketing-home">
        <section className="marketing-hero">
          <div className="marketing-hero-orbitals" aria-hidden="true">
            <span className="marketing-hero-orbital marketing-hero-orbital-lilac" />
            <span className="marketing-hero-orbital marketing-hero-orbital-gold" />
            <span className="marketing-hero-orbital marketing-hero-orbital-pink" />
            <i className="marketing-hero-spark marketing-hero-spark-one" />
            <i className="marketing-hero-spark marketing-hero-spark-two" />
            <i className="marketing-hero-spark marketing-hero-spark-three" />
          </div>
          <div className="marketing-container marketing-hero-grid">
            <div className="marketing-hero-copy">
              <p className="marketing-eyebrow marketing-hero-eyebrow">{getTranslation("marketing.heroEyebrow")}</p>
              <h1 className="marketing-hero-title"><span>{getTranslation("marketing.heroLineOne")}</span>{" "}<span>{getTranslation("marketing.heroLineTwo")}</span></h1>
              <p className="marketing-hero-description">{getTranslation("marketing.heroDescription")}</p>
              <div className="marketing-hero-actions">
                <a href={getApplicationLink("/signup")} className="marketing-button marketing-button-primary" onClick={() => { trackMarketingEvent("hero_start_free_click", { source: "hero" }); trackMarketingEvent("signup_started", { source: "hero" }) }}>
                  {getTranslation("marketing.startForFree")} <ArrowRight aria-hidden="true" />
                </a>
                <Link href="/#how-it-works" className="marketing-button marketing-button-light" onClick={(event) => { trackMarketingEvent("hero_how_it_works_click", { source: "hero" }); handleHowItWorksClick(event) }}>
                  {getTranslation("marketing.heroDemo")} <ArrowUpRight aria-hidden="true" />
                </Link>
              </div>
              <p className="marketing-reassurance"><Check aria-hidden="true" />{getTranslation("marketing.heroReassurance")}</p>
              <div className="marketing-hero-channels" role="group" aria-labelledby="marketing-hero-channels-label">
                <p className="marketing-hero-channels-label" id="marketing-hero-channels-label">{getTranslation("marketing.heroChannelsLabel")}</p>
                <div className="marketing-hero-category-list" role="list">
                  {HERO_CHANNEL_CATEGORIES.map(({ key, Icon }) => (
                    <span className="marketing-hero-category-item" key={key} role="listitem"><Icon aria-hidden="true" />{getTranslation(key)}</span>
                  ))}
                </div>
              </div>
            </div>
            <ProductShowcase />
          </div>
        </section>

        <section className="marketing-proof-strip" aria-label={getTranslation("marketing.proofEyebrow")}>
          <div className="marketing-container marketing-proof-grid">
            <span className="marketing-proof-lead">{getTranslation("marketing.proofEyebrow")}</span>
            <span><Check aria-hidden="true" />{getTranslation("marketing.proofNoCard")}</span>
            <span><Check aria-hidden="true" />{getTranslation("marketing.proofNoFees")}</span>
            <span><Check aria-hidden="true" />{getTranslation("marketing.proofFreePlan")}</span>
            <span><Check aria-hidden="true" />{getTranslation("marketing.proofLiveMinutes")}</span>
          </div>
        </section>

        <section className="marketing-section marketing-outcomes-section" id="product">
          <div className="marketing-container">
            <div className="marketing-section-heading marketing-section-heading-centered">
              <p className="marketing-eyebrow">{getTranslation("marketing.outcomesEyebrow")}</p>
              <h2>{getTranslation("marketing.outcomesHeading")}</h2>
            </div>
            <div className="marketing-outcomes-grid">
              <article className="marketing-outcome-card">
                <OutcomeVisual kind="bookings" alt={getTranslation("marketing.outcomeBookingsTitle")} />
                <span className="marketing-outcome-number">01</span>
                <h3>{getTranslation("marketing.outcomeBookingsTitle")}</h3>
                <p>{getTranslation("marketing.outcomeBookingsDescription")}</p>
              </article>
              <article className="marketing-outcome-card">
                <OutcomeVisual kind="operations" alt={getTranslation("marketing.outcomeOperationsTitle")} />
                <span className="marketing-outcome-number">02</span>
                <h3>{getTranslation("marketing.outcomeOperationsTitle")}</h3>
                <p>{getTranslation("marketing.outcomeOperationsDescription")}</p>
              </article>
              <article className="marketing-outcome-card">
                <OutcomeVisual kind="guests" alt={getTranslation("marketing.outcomeGuestsTitle")} />
                <span className="marketing-outcome-number">03</span>
                <h3>{getTranslation("marketing.outcomeGuestsTitle")}</h3>
                <p>{getTranslation("marketing.outcomeGuestsDescription")}</p>
              </article>
            </div>
          </div>
        </section>

        <section className="marketing-section marketing-core-product-section marketing-section-dark" id="core-product">
          <div className="marketing-container marketing-two-column marketing-core-product-grid">
            <div className="marketing-section-heading marketing-section-heading-light">
              <p className="marketing-eyebrow">{getTranslation("marketing.coreProductEyebrow")}</p>
              <h2>{getTranslation("marketing.coreProductHeading")}</h2>
              <p>{getTranslation("marketing.coreProductDescription")}</p>
              <div className="marketing-source-list" aria-label={getTranslation("marketing.heroChannelsLabel")}>
                {HERO_CHANNEL_CATEGORIES.map(({ key, Icon }) => <span key={key}><Icon aria-hidden="true" />{getTranslation(key)}</span>)}
              </div>
            </div>
            <div className="marketing-core-product-visual" aria-label={getTranslation("marketing.dashboardDesktop")}>
              <Image src="/assets/screenshots/6-valid.webp" alt={getTranslation("marketing.dashboardDesktop")} fill sizes="(min-width: 900px) 52vw, 94vw" />
            </div>
          </div>
        </section>

        <section className="marketing-section marketing-showcase-section marketing-guest-experience-section" id="guest-experience">
          <div className="marketing-container marketing-two-column">
            <div className="marketing-section-heading">
              <p className="marketing-eyebrow">{getTranslation("marketing.guestEyebrow")}</p>
              <h2>{getTranslation("marketing.guestHeading")}</h2>
              <p>{getTranslation("marketing.guestDescription")}</p>
              <ul className="marketing-check-list">
                <li><Check aria-hidden="true" />{getTranslation("marketing.guestHostedPage")}</li>
                <li><Check aria-hidden="true" />{getTranslation("marketing.guestDirectBooking")}</li>
                <li><Check aria-hidden="true" />{getTranslation("marketing.guestMobile")}</li>
                <li><Check aria-hidden="true" />{getTranslation("marketing.guestBranding")}</li>
              </ul>
              <p className="marketing-guest-domain-note"><Globe2 aria-hidden="true" />{getTranslation("marketing.guestNoMarketplace")}</p>
              <Link href="/#how-it-works" className="marketing-text-link">{getTranslation("marketing.seeHow")} <span aria-hidden="true">→</span></Link>
            </div>
            <GuestBookingVisual getTranslation={getTranslation} />
          </div>
        </section>

        <section className="marketing-section marketing-how-it-works-section" id="how-it-works">
          <div className="marketing-container">
            <div className="marketing-section-heading marketing-section-heading-centered marketing-how-heading">
              <p className="marketing-eyebrow">{getTranslation("marketing.howEyebrow")}</p>
              <h2>{getTranslation("marketing.howHeading")}</h2>
            </div>
            <HowItWorksSteps steps={localizedSteps} />
          </div>
        </section>

        <section className="marketing-section marketing-ai-section" id="ai">
          <div className="marketing-container">
            <div className="marketing-section-heading marketing-section-heading-centered">
              <p className="marketing-eyebrow">{getTranslation("marketing.aiEyebrow")}</p>
              <h2>{getTranslation("marketing.aiHeading")}</h2>
              <p>{getTranslation("marketing.aiDescription")}</p>
            </div>
            <div className="marketing-ai-grid">
              <article className="marketing-ai-card"><span className="marketing-ai-card-icon marketing-ai-card-icon-green" aria-hidden="true"><BookOpen /></span><h3>{getTranslation("marketing.aiPublicDataTitle")}</h3><p>{getTranslation("marketing.aiPublicDataDescription")}</p></article>
              <article className="marketing-ai-card"><span className="marketing-ai-card-icon marketing-ai-card-icon-blue" aria-hidden="true"><Braces /></span><h3>{getTranslation("marketing.aiApiTitle")}</h3><p>{getTranslation("marketing.aiApiDescription")}</p></article>
              <article className="marketing-ai-card"><span className="marketing-ai-card-icon marketing-ai-card-icon-pink" aria-hidden="true"><Bot /></span><h3>{getTranslation("marketing.aiMcpTitle")}</h3><p>{getTranslation("marketing.aiMcpDescription")}</p></article>
            </div>
            <div className="marketing-ai-footer">
              <p>{getTranslation("marketing.aiFooter")}</p>
              <div className="marketing-ai-actions"><Link href="/docs" className="marketing-button marketing-button-dark">{getTranslation("marketing.readDocs")} <ArrowRight aria-hidden="true" /></Link><Link href="/docs/agents" className="marketing-text-link">{getTranslation("marketing.agentGuide")} <span aria-hidden="true">→</span></Link></div>
            </div>
          </div>
        </section>

        <section className="marketing-section marketing-capabilities-section">
          <div className="marketing-container">
            <div className="marketing-section-heading marketing-section-heading-centered">
              <p className="marketing-eyebrow">{getTranslation("marketing.capabilitiesEyebrow")}</p>
              <h2>{getTranslation("marketing.capabilitiesHeading")}</h2>
              <p>{getTranslation("marketing.capabilitiesDescription")}</p>
            </div>
            <div className="marketing-capabilities-grid">
              {capabilities.map(({ key, description, Icon }) => <article className="marketing-capability-item" key={key}><Icon aria-hidden="true" /><div><h3>{getTranslation(key)}</h3><p>{getTranslation(description)}</p></div></article>)}
            </div>
          </div>
        </section>

        <section className="marketing-section marketing-pricing-section" id="pricing-preview">
          <div className="marketing-container">
            <div className="marketing-section-heading marketing-section-heading-centered"><p className="marketing-eyebrow">{getTranslation("marketing.pricingEyebrow")}</p><h2>{getTranslation("marketing.pricingHeading")}</h2><p>{getTranslation("marketing.pricingDescription")}</p></div>
            <PricingGrid plans={plans} billingPrices={billingPrices} variant="compact" />
            <div className="marketing-centered-link"><Link href="/pricing#feature-comparison" className="marketing-text-link marketing-pricing-compare-link">{getTranslation("marketing.fullComparison")} <span aria-hidden="true">→</span></Link></div>
          </div>
        </section>

        <section className="marketing-section marketing-faq-section" id="faq">
          <div className="marketing-container marketing-faq-layout"><div className="marketing-section-heading"><p className="marketing-eyebrow">{getTranslation("marketing.questionsEyebrow")}</p><h2>{getTranslation("marketing.questionsHeading")}</h2><p>{getTranslation("marketing.questionsDescription")}</p></div><div className="marketing-faq-list">{localizedFaqs.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></div>
        </section>

        <section className="marketing-final-cta marketing-final-cta-compact">
          <div className="marketing-container marketing-final-cta-inner">
            <p className="marketing-eyebrow marketing-eyebrow-light">{getTranslation("marketing.finalEyebrow")}</p>
            <h2>{getTranslation("marketing.finalHeading")}</h2>
            <p>{getTranslation("marketing.finalDescription")}</p>
            <a href={getApplicationLink("/signup")} className="marketing-button marketing-button-primary" onClick={() => { trackMarketingEvent("final_cta_click", { source: "final_cta" }); trackMarketingEvent("signup_started", { source: "final_cta" }) }}>
              {getTranslation("marketing.getStarted")} <ArrowRight aria-hidden="true" />
            </a>
            <span className="marketing-final-reassurance"><Check aria-hidden="true" />{getTranslation("marketing.heroReassurance")}</span>
          </div>
        </section>
      </main>
    </MarketingLayout>
  )
}
