"use client"

import Link from "next/link"
import Image from "next/image"
import { useEffect, useRef } from "react"
import { getApplicationLink } from "@/lib/platform-urls"
import { trackMarketingEvent } from "@/lib/marketing/analytics"
import { RESERVEVIA_LOGO_DARK } from "@/lib/brand-assets"
import { useLanguage } from "@/context/language-context"
import { LanguageSelector } from "@/components/language-selector"

export function MarketingHeader() {
  const { getTranslation } = useLanguage()
  const mobileMenuRef = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    const closeMenuOnOutsidePointer = (event: PointerEvent) => {
      const menu = mobileMenuRef.current
      if (!menu?.open || menu.contains(event.target as Node)) return
      menu.open = false
    }

    document.addEventListener("pointerdown", closeMenuOnOutsidePointer)
    return () => document.removeEventListener("pointerdown", closeMenuOnOutsidePointer)
  }, [])

  const closeMobileMenu = () => {
    if (mobileMenuRef.current) mobileMenuRef.current.open = false
  }

  return (
    <header className="marketing-header">
      <div className="marketing-container marketing-header-inner">
        <Link href="/" className="marketing-wordmark" aria-label={getTranslation("marketing.homeLabel")}>
          <span className="marketing-wordmark-mark" aria-hidden="true">
            <Image src={RESERVEVIA_LOGO_DARK} alt="" width={32} height={32} sizes="32px" priority />
          </span>
          <span>ReserveVia</span>
        </Link>

        <nav className="marketing-nav" aria-label={getTranslation("marketing.mainNavigation")}>
          <Link href="/#product">{getTranslation("marketing.product")}</Link>
          <Link href="/#ai">{getTranslation("marketing.aiAndAgents")}</Link>
          <Link href="/pricing">{getTranslation("marketing.pricing")}</Link>
          <Link href="/docs">{getTranslation("marketing.docs")}</Link>
        </nav>

        <div className="marketing-header-actions">
          <LanguageSelector />
          <a href={getApplicationLink("/login")} className="marketing-header-login">{getTranslation("marketing.login")}</a>
          <a href={getApplicationLink("/signup")} className="marketing-button marketing-button-primary marketing-button-small" onClick={() => trackMarketingEvent("signup_started", { source: "header" })}>{getTranslation("marketing.startFree")}</a>
        </div>

        <details ref={mobileMenuRef} className="marketing-mobile-menu">
          <summary aria-label={getTranslation("marketing.openMenu")}>
            <span className="marketing-menu-label">{getTranslation("marketing.menu")}</span>
            <span className="marketing-menu-icon" aria-hidden="true"><i /><i /><i /></span>
          </summary>
          <nav aria-label={getTranslation("marketing.mainNavigation")}>
            <Link href="/#product" onClick={closeMobileMenu}>{getTranslation("marketing.product")}</Link>
            <Link href="/#ai" onClick={closeMobileMenu}>{getTranslation("marketing.aiAndAgents")}</Link>
            <Link href="/pricing" onClick={closeMobileMenu}>{getTranslation("marketing.pricing")}</Link>
            <Link href="/docs" onClick={closeMobileMenu}>{getTranslation("marketing.docs")}</Link>
            <a href={getApplicationLink("/login")} onClick={closeMobileMenu}>{getTranslation("marketing.login")}</a>
            <a href={getApplicationLink("/signup")} onClick={() => { closeMobileMenu(); trackMarketingEvent("signup_started", { source: "header" }) }} className="marketing-button marketing-button-primary">{getTranslation("marketing.startFree")}</a>
          </nav>
        </details>
      </div>
    </header>
  )
}
