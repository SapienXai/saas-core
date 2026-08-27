"use client"

import { ArrowUpRight, Globe2, Sparkles } from "lucide-react"
import { useEffect, useState } from "react"
import { useLanguage } from "@/context/language-context"

const DOMAIN_OPTIONS = [
  "the-garden-room.reservevia.com",
  "harborandolive.reservevia.com",
  "northpier.reservevia.com",
  "your-restaurant.reservevia.com",
  "book.yourrestaurant.com",
] as const

const FLOATING_DOMAINS = [
  { label: "reservevia.com", className: "marketing-domain-orbiter-one" },
  { label: "gardenroom", className: "marketing-domain-orbiter-two" },
  { label: ".com", className: "marketing-domain-orbiter-three" },
  { label: "yourrestaurant.com", className: "marketing-domain-orbiter-four" },
] as const

export function MarketingDomainShowcase() {
  const { getTranslation } = useLanguage()
  const [domainIndex, setDomainIndex] = useState(0)
  const activeDomain = DOMAIN_OPTIONS[domainIndex]

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
    if (reducedMotion.matches) return

    const interval = window.setInterval(() => {
      setDomainIndex((current) => (current + 1) % DOMAIN_OPTIONS.length)
    }, 2600)

    return () => window.clearInterval(interval)
  }, [])

  return (
    <div className="marketing-domain-stage" role="group" aria-labelledby="marketing-domain-picker-title">
      <div className="marketing-domain-orbiters" aria-hidden="true">
        {FLOATING_DOMAINS.map(({ label, className }) => <span className={`marketing-domain-orbiter ${className}`} key={label}>{label}</span>)}
      </div>

      <div className="marketing-domain-picker">
        <div className="marketing-domain-picker-top">
          <span id="marketing-domain-picker-title" className="marketing-domain-picker-title"><Globe2 aria-hidden="true" />{getTranslation("marketing.domainPickerTitle")}</span>
          <span className="marketing-domain-picker-status"><i aria-hidden="true" />{getTranslation("marketing.domainPickerStatus")}</span>
        </div>
        <div className="marketing-domain-picker-field" aria-label={activeDomain}>
          <span className="marketing-domain-picker-prefix">https://</span>
          <span className="marketing-domain-picker-value" aria-live="polite" aria-atomic="true">{activeDomain}</span>
          <ArrowUpRight aria-hidden="true" />
        </div>
        <div className="marketing-domain-picker-footer">
          <span><Sparkles aria-hidden="true" />{getTranslation("marketing.domainPickerCycle")}</span>
          <span>{getTranslation("marketing.domainPickerCustom")}</span>
        </div>
      </div>
    </div>
  )
}
