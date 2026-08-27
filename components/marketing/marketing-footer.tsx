"use client"

import Link from "next/link"
import Image from "next/image"
import { ArrowUpRight } from "lucide-react"
import { getApplicationLink } from "@/lib/platform-urls"
import { RESERVEVIA_LOGO_LIGHT } from "@/lib/brand-assets"
import { useLanguage } from "@/context/language-context"

export function MarketingFooter() {
  const { getTranslation } = useLanguage()
  return (
    <footer className="marketing-footer">
      <div className="marketing-container marketing-footer-inner">
        <div className="marketing-footer-main">
          <div className="marketing-footer-brand">
            <Link href="/" className="marketing-wordmark marketing-wordmark-footer">
              <span className="marketing-wordmark-mark" aria-hidden="true">
                <Image src={RESERVEVIA_LOGO_LIGHT} alt="" width={32} height={32} sizes="32px" />
              </span>
              <span>RESERVEVIA</span>
            </Link>
            <p className="marketing-footer-copy">{getTranslation("marketing.footerCopy")}</p>
            <a href={getApplicationLink("/signup")} className="marketing-footer-start-link">
              {getTranslation("marketing.startForFree")} <ArrowUpRight aria-hidden="true" />
            </a>
          </div>
        <nav className="marketing-footer-links" aria-label={getTranslation("marketing.footerNavigation")}>
            <div>
              <p className="marketing-footer-label">{getTranslation("marketing.product")}</p>
              <Link href="/#product">{getTranslation("marketing.productOverview")}</Link>
              <Link href="/#how-it-works">{getTranslation("marketing.howItWorks")}</Link>
              <Link href="/pricing">{getTranslation("marketing.pricing")}</Link>
            </div>
            <div>
              <p className="marketing-footer-label">{getTranslation("marketing.explore")}</p>
              <Link href="/restaurants">{getTranslation("marketing.restaurantExamples")}</Link>
              <Link href="/docs">{getTranslation("marketing.docs")}</Link>
              <Link href="/docs/agents">{getTranslation("marketing.agentGuide")}</Link>
              <Link href="/#faq">{getTranslation("marketing.faq")}</Link>
              <Link href="/privacy">{getTranslation("footer.privacy")}</Link>
            </div>
            <div>
              <p className="marketing-footer-label">{getTranslation("marketing.account")}</p>
              <a href={getApplicationLink("/login")}>{getTranslation("marketing.login")}</a>
              <a href={getApplicationLink("/signup")}>{getTranslation("marketing.getStarted")}</a>
              <Link href="/terms">{getTranslation("footer.terms")}</Link>
            </div>
          </nav>
        </div>
        <div className="marketing-footer-bottom">
          <span>© {new Date().getFullYear()} Reservevia by <a className="marketing-footer-credit-link" href="https://sapienxtech.com/" target="_blank" rel="noreferrer">SapienX</a></span>
          <span className="marketing-footer-status"><i aria-hidden="true" /> {getTranslation("marketing.builtForAgents")}</span>
        </div>
      </div>
    </footer>
  )
}
