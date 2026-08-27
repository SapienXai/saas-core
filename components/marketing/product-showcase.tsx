"use client"

import Image from "next/image"
import { Check, Globe2, Smartphone, UsersRound } from "lucide-react"
import { useLanguage } from "@/context/language-context"

function BrowserDots() {
  return (
    <div className="marketing-screenshot-browser-dots" aria-hidden="true">
      <i />
      <i />
      <i />
    </div>
  )
}

export function ProductShowcase() {
  const { getTranslation } = useLanguage()

  return (
    <div className="marketing-showcase marketing-app-showcase" aria-label={getTranslation("marketing.reservationPreview")}>
      <div className="marketing-screenshot-stage">
        <div className="marketing-screenshot-device marketing-screenshot-desktop">
          <div className="marketing-screenshot-browser-bar">
            <BrowserDots />
            <span className="marketing-screenshot-address">app.reservevia.com/dashboard</span>
            <span className="marketing-screenshot-browser-action" aria-hidden="true">↗</span>
          </div>
          <div className="marketing-screenshot-screen">
            <Image
              src="/assets/screenshots/6-valid.webp"
              alt={getTranslation("marketing.dashboardDesktop")}
              fill
              fetchPriority="high"
              sizes="(min-width: 1200px) 48vw, (min-width: 640px) 58vw, 94vw"
            />
          </div>
        </div>

        <div className="marketing-screenshot-device marketing-screenshot-phone">
          <div className="marketing-screenshot-phone-speaker" aria-hidden="true" />
          <div className="marketing-screenshot-screen">
            <Image
              src="/assets/screenshots/4-valid.webp"
              alt={getTranslation("marketing.dashboardMobile")}
              fill
              sizes="(min-width: 900px) 18vw, 34vw"
            />
          </div>
        </div>
      </div>

      <div className="marketing-showcase-caption">
        <span><Globe2 aria-hidden="true" /> {getTranslation("marketing.hostedBookingPage")}</span>
        <span><Smartphone aria-hidden="true" /> {getTranslation("marketing.mobileBeautiful")}</span>
        <span><UsersRound aria-hidden="true" /> {getTranslation("marketing.teamAccess")}</span>
        <span><Check aria-hidden="true" /> {getTranslation("marketing.noBookingFees")}</span>
      </div>
    </div>
  )
}
