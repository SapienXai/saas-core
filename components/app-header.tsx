"use client"

import { useLanguage } from "@/context/language-context"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { LanguageSelector } from "./language-selector"
import { RESERVEVIA_LOGO_LIGHT } from "@/lib/brand-assets"

interface AppHeaderProps {
  isIndexPage?: boolean
  restaurantName?: string
  subtitle?: string
  showBackButton?: boolean
  currentStep?: number
  onBack?: () => void
}

export function AppHeader({
  isIndexPage = false,
  restaurantName,
  subtitle,
  showBackButton = false,
  currentStep = 1,
  onBack,
}: AppHeaderProps) {
  const { getTranslation } = useLanguage()
  const router = useRouter()

  const handleBack = () => {
    if (onBack) {
      onBack()
    } else if (currentStep === 2) {
      // Go back to step 1 (handled by parent component)
      window.history.back()
    } else {
      // Go back to index page
      router.push(`/`)
    }
  }

  const headerClass = isIndexPage ? "app-header index-page-app-header" : "app-header reservation-app-header-glass backdrop-blur-xl backdrop-saturate-150"
  const titleClass = isIndexPage ? "main-title" : "main-title"

  return (
    <div className={headerClass}>
      <div className="app-header-side app-header-side-left">
        {showBackButton ? (
          <button type="button" className="app-header-action-btn" aria-label={getTranslation("common.back")} onClick={handleBack}>
            <ArrowLeft size={24} />
          </button>
        ) : (
          <div className="app-header-logo-wrapper">
            <Image src={RESERVEVIA_LOGO_LIGHT} alt="Reservevia" width={32} height={32} />
          </div>
        )}
      </div>

      <div className="title-section">
        <h1 className={titleClass}>
          {isIndexPage ? getTranslation("header.title") : restaurantName || getTranslation("header.title")}
        </h1>
        {subtitle && <p className="sub-title">{subtitle}</p>}
      </div>

      <div className="app-header-side app-header-side-right">
        {isIndexPage && (
          <div className="language-switcher">
            <LanguageSelector />
          </div>
        )}
      </div>
    </div>
  )
}
