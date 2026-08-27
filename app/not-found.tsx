"use client"

import Link from "next/link"
import { ArrowRight, Sparkles } from "lucide-react"
import { MarketingLayout } from "@/components/marketing/marketing-layout"
import { useLanguage } from "@/context/language-context"

export default function NotFound() {
  const { getTranslation } = useLanguage()

  return (
    <MarketingLayout>
      <main className="marketing-not-found" aria-labelledby="not-found-title">
        <div className="marketing-not-found-glow marketing-not-found-glow-one" aria-hidden="true" />
        <div className="marketing-not-found-glow marketing-not-found-glow-two" aria-hidden="true" />

        <div className="marketing-container marketing-not-found-inner">
          <div className="marketing-not-found-art" aria-hidden="true">
            <span className="marketing-not-found-orbit marketing-not-found-orbit-one" />
            <span className="marketing-not-found-orbit marketing-not-found-orbit-two" />
            <span className="marketing-not-found-star marketing-not-found-star-one"><Sparkles /></span>
            <span className="marketing-not-found-star marketing-not-found-star-two"><Sparkles /></span>
            <div className="marketing-not-found-numbers">
              <span>4</span>
              <span className="marketing-not-found-zero"><i /><b>0</b></span>
              <span>4</span>
            </div>
            <span className="marketing-not-found-floor" />
          </div>

          <div className="marketing-not-found-copy">
            <p className="marketing-eyebrow marketing-not-found-eyebrow">{getTranslation("public.notFoundEyebrow")}</p>
            <h1 id="not-found-title">{getTranslation("public.notFoundHeading")}</h1>
            <p className="marketing-not-found-description">{getTranslation("public.notFoundDescription")}</p>

            <div className="marketing-not-found-actions">
              <Link href="/" className="marketing-button marketing-button-primary">
                {getTranslation("public.notFoundHome")}
                <ArrowRight aria-hidden="true" />
              </Link>
              <Link href="/restaurants" className="marketing-button marketing-button-light">
                {getTranslation("public.notFoundRestaurants")}
              </Link>
            </div>

            <p className="marketing-not-found-note">
              <span aria-hidden="true" />
              {getTranslation("public.notFoundHint")}
            </p>
          </div>
        </div>
      </main>
    </MarketingLayout>
  )
}
