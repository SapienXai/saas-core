"use client"

import Image from "next/image"
import Link from "next/link"
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react"
import {
  ArrowRight,
  BarChart3,
  CalendarCheck2,
  CalendarDays,
  ChevronDown,
  Clock3,
  Facebook,
  Globe2,
  Instagram,
  Leaf,
  MapPin,
  MessageCircle,
  Music2,
  Phone,
  Twitter,
  Utensils,
  Waves,
  Youtube,
} from "lucide-react"
import { useLanguage } from "@/context/language-context"
import { localeConfig, type SupportedLanguage } from "@/i18n"
import { normalizeSocialLinks, type PublicRestaurantProfile, type SocialPlatform } from "@/lib/restaurant-profile"
import { getPlatformUrl } from "@/lib/platform-urls"
import { RecentReservation } from "@/components/recent-reservation"
import { RESERVEVIA_LOGO_DARK, RESERVEVIA_LOGO_LIGHT } from "@/lib/brand-assets"
import { getSafeRestaurantAssetUrl } from "@/lib/legacy-assets"
import { ReserveviaPhysicsCover } from "@/components/reservevia-physics-cover"
import { ReservationApp } from "@/components/reservation-app"
import { PublicRestaurantDeviceFrame } from "@/components/public-restaurant-device-frame"

const DEFAULT_RESTAURANT_LOGO = RESERVEVIA_LOGO_LIGHT

const PUBLIC_SOCIAL_PLATFORMS: ReadonlyArray<{ platform: SocialPlatform; label: string; Icon: typeof Instagram }> = [
  { platform: "instagram", label: "Instagram", Icon: Instagram },
  { platform: "facebook", label: "Facebook", Icon: Facebook },
  { platform: "tiktok", label: "TikTok", Icon: Music2 },
  { platform: "youtube", label: "YouTube", Icon: Youtube },
  { platform: "x", label: "X", Icon: Twitter },
  { platform: "website", label: "Website", Icon: Globe2 },
]

function ContactButton({
  href,
  label,
  variant,
  children,
}: {
  href: string
  label: string
  variant: "whatsapp" | "phone"
  children: ReactNode
}) {
  return (
    <a
      href={href}
      className={`public-restaurant-contact public-restaurant-contact-${variant}`}
      aria-label={label}
      target={variant === "whatsapp" ? "_blank" : undefined}
      rel={variant === "whatsapp" ? "noreferrer noopener" : undefined}
    >
      {children}
    </a>
  )
}

function DetailCard({
  icon,
  label,
  value,
}: {
  icon: ReactNode
  label: string
  value: string
}) {
  const valueRef = useRef<HTMLSpanElement>(null)
  const [isValueOverflowing, setIsValueOverflowing] = useState(false)

  useEffect(() => {
    const valueElement = valueRef.current
    if (!valueElement) return

    const measure = () => setIsValueOverflowing(valueElement.scrollWidth > valueElement.clientWidth + 1)
    const frame = requestAnimationFrame(measure)
    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(valueElement)

    return () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
    }
  }, [value])

  return (
    <div className="public-restaurant-detail-card">
      <span className="public-restaurant-detail-icon" aria-hidden="true">{icon}</span>
      <span className="public-restaurant-detail-copy">
        <span className="public-restaurant-detail-label">{label}</span>
        <span
          ref={valueRef}
          className={`public-restaurant-detail-value${value.length > 10 ? " public-restaurant-detail-value-long" : ""}${isValueOverflowing ? " public-restaurant-detail-value-overflowing" : ""}`}
        >
          <span className="public-restaurant-detail-value-track">
            <span>{value}</span>
            {isValueOverflowing && <span aria-hidden="true">{value}</span>}
          </span>
        </span>
      </span>
    </div>
  )
}

function BottomAction({
  href,
  label,
  icon,
}: {
  href: string | null
  label: string
  icon: ReactNode
}) {
  const className = `public-restaurant-bottom-action${href ? "" : " public-restaurant-bottom-action-disabled"}`
  const content = (
    <>
      <span aria-hidden="true">{icon}</span>
      <span>{label}</span>
    </>
  )

  if (!href) {
    return <span className={className} aria-disabled="true">{content}</span>
  }

  return <a href={href} className={className} target="_blank" rel="noreferrer noopener">{content}</a>
}

function RestaurantAutoFitName({ name, variant = "header" }: { name: string; variant?: "header" | "hero" }) {
  const viewportRef = useRef<HTMLSpanElement>(null)
  const trackRef = useRef<HTMLSpanElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [fontSize, setFontSize] = useState<number | null>(null)
  const [isOverflowing, setIsOverflowing] = useState(false)
  const isHero = variant === "hero"
  const viewportClassName = isHero ? "public-restaurant-hero-name" : "public-restaurant-header-name"
  const trackClassName = isHero ? "public-restaurant-hero-name-track" : "public-restaurant-header-name-track"
  const overflowingClassName = isHero ? "public-restaurant-hero-name-overflowing" : "public-restaurant-header-name-overflowing"

  useEffect(() => {
    const viewport = viewportRef.current
    const track = trackRef.current
    const text = textRef.current
    if (!viewport || !track || !text) return

    const measure = () => {
      track.style.fontSize = ""
      const maxFontSize = Number.parseFloat(getComputedStyle(track).fontSize) || (isHero ? 48 : 21.6)
      const minFontSize = isHero ? 20 : 12
      let nextFontSize = maxFontSize

      track.style.fontSize = `${nextFontSize}px`
      while (nextFontSize > minFontSize && text.scrollWidth > viewport.clientWidth) {
        nextFontSize -= 0.5
        track.style.fontSize = `${nextFontSize}px`
      }

      setFontSize(nextFontSize)
      setIsOverflowing(text.scrollWidth > viewport.clientWidth + 1)
    }

    measure()
    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(viewport)

    return () => resizeObserver.disconnect()
  }, [isHero, name])

  return (
    <span
      ref={viewportRef}
      className={`${viewportClassName}${isOverflowing ? ` ${overflowingClassName}` : ""}`}
      aria-label={name}
    >
      <span
        ref={trackRef}
        className={trackClassName}
        style={fontSize === null ? undefined : { fontSize: `${fontSize}px` }}
      >
        <span ref={textRef}>{name}</span>
        {isOverflowing && <span aria-hidden="true">{name}</span>}
      </span>
    </span>
  )
}

function PublicRestaurantDesktopMedia() {
  const { currentLang, getTranslation } = useLanguage()

  return (
    <aside className="public-restaurant-desktop-media" aria-label="Reservevia">
      <video
        className="public-restaurant-desktop-media-video"
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        aria-hidden="true"
      >
        <source src="/assets/banner.webm" type="video/webm" />
        <source src="/assets/banner.mp4" type="video/mp4" />
      </video>
      <div className="public-restaurant-desktop-media-shade" aria-hidden="true" />
      <div className="public-restaurant-desktop-media-content">
        <Link href="/" className="public-restaurant-desktop-brand" aria-label={getTranslation("auth.homeLabel")}>
          <Image src={RESERVEVIA_LOGO_DARK} alt="" width={48} height={48} priority />
          <span>RESERVEVIA</span>
        </Link>

        <div className="public-restaurant-desktop-copy">
          <p className="public-restaurant-desktop-kicker">{getTranslation("auth.kicker")}</p>
          <h2 data-language={currentLang}>{getTranslation("auth.headline")}</h2>
          <p>{getTranslation("auth.description")}</p>
          <div className="public-restaurant-desktop-benefits">
            {[
              { Icon: CalendarCheck2, title: getTranslation("auth.moreReservations"), description: getTranslation("auth.moreReservationsDescription") },
              { Icon: Clock3, title: getTranslation("auth.saveTime"), description: getTranslation("auth.saveTimeDescription") },
              { Icon: BarChart3, title: getTranslation("auth.growConfidence"), description: getTranslation("auth.growConfidenceDescription") },
            ].map(({ Icon, title, description }) => (
              <div key={title} className="public-restaurant-desktop-benefit">
                <span aria-hidden="true"><Icon /></span>
                <span>
                  <strong>{title}</strong>
                  <small>{description}</small>
                </span>
              </div>
            ))}
          </div>
        </div>

        <p className="public-restaurant-desktop-footnote">{getTranslation("auth.footnote")}</p>
      </div>
    </aside>
  )
}

export function RestaurantLandingPage({ restaurant, preview = false, reservationToken, backHref }: { restaurant: PublicRestaurantProfile; preview?: boolean; reservationToken?: string; backHref?: string }) {
  const { currentLang, setLanguage, getTranslation } = useLanguage()
  const supportedLanguages = Object.keys(localeConfig) as SupportedLanguage[]
  const currentLanguageIndex = Math.max(0, supportedLanguages.indexOf(currentLang))
  const nextLanguage = supportedLanguages[(currentLanguageIndex + 1) % supportedLanguages.length] || currentLang
  const reserveHref = preview
    ? "#preview-reservation"
    : (() => {
        const params = new URLSearchParams({ restaurantSlug: restaurant.slug, lang: currentLang })
        if (backHref) params.set("from", backHref)
        return `/reserve?${params.toString()}`
      })()
  const visibility = restaurant.visibility
  const phoneNumber = visibility.phone ? restaurant.phone : null
  const whatsappNumber = visibility.whatsapp ? (restaurant.whatsapp || (visibility.phone ? restaurant.phone : null))?.replace(/\D/g, "") : null
  const languageLabel = currentLang.toUpperCase()
  const socialLinks = normalizeSocialLinks(restaurant.socialLinks)
  const visibleSocialLinks = PUBLIC_SOCIAL_PLATFORMS.filter(({ platform }) => Boolean(socialLinks[platform]))
  const safeLogoUrl = getSafeRestaurantAssetUrl(restaurant.logoUrl, DEFAULT_RESTAURANT_LOGO) || DEFAULT_RESTAURANT_LOGO
  const safePrimaryImageUrl = getSafeRestaurantAssetUrl(restaurant.primaryImageUrl)
  const descriptionRef = useRef<HTMLSpanElement>(null)
  const heroImageRef = useRef<HTMLImageElement>(null)
  const [logoUrl, setLogoUrl] = useState(safeLogoUrl)
  const [heroImageFailed, setHeroImageFailed] = useState(false)
  const [heroImageLoaded, setHeroImageLoaded] = useState(false)
  const [descriptionExpanded, setDescriptionExpanded] = useState(false)
  const [descriptionCanExpand, setDescriptionCanExpand] = useState(false)
  const [isDesktopReservationOpen, setIsDesktopReservationOpen] = useState(false)

  useEffect(() => {
    setLogoUrl(safeLogoUrl)
  }, [safeLogoUrl])

  useEffect(() => {
    setHeroImageFailed(false)
    setHeroImageLoaded(false)
  }, [safePrimaryImageUrl])

  useEffect(() => {
    const image = heroImageRef.current
    if (!safePrimaryImageUrl || !image?.complete) return
    if (image.naturalWidth > 0) {
      setHeroImageLoaded(true)
    } else {
      setHeroImageFailed(true)
    }
  }, [safePrimaryImageUrl])

  useEffect(() => {
    setDescriptionExpanded(false)
    setDescriptionCanExpand(false)
  }, [restaurant.description])

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1000px)")
    const handleViewportChange = () => {
      if (!mediaQuery.matches) setIsDesktopReservationOpen(false)
    }

    handleViewportChange()
    mediaQuery.addEventListener("change", handleViewportChange)
    return () => mediaQuery.removeEventListener("change", handleViewportChange)
  }, [])

  useEffect(() => {
    const description = descriptionRef.current
    if (!description || !restaurant.description || descriptionExpanded) return

    const measure = () => setDescriptionCanExpand(description.scrollHeight > description.clientHeight + 1)
    const frame = requestAnimationFrame(measure)
    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(description)

    return () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
    }
  }, [descriptionExpanded, restaurant.description])

  const handleReserveClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (preview || !window.matchMedia("(min-width: 1000px)").matches) return
    event.preventDefault()
    setIsDesktopReservationOpen(true)
  }

  return (
    <main className={`public-restaurant-experience${preview ? " public-restaurant-preview-experience" : ""}`}>
      <PublicRestaurantDesktopMedia />
      <PublicRestaurantDeviceFrame>
        <div className={`public-restaurant-page${isDesktopReservationOpen ? " public-restaurant-page-reservation-open" : ""}`}>
        {isDesktopReservationOpen ? (
          <div className="public-restaurant-embedded-reservation">
            <ReservationApp
              embedded
              initialRestaurant={restaurant.name}
              initialRestaurantSlug={restaurant.slug}
              onBack={() => setIsDesktopReservationOpen(false)}
            />
          </div>
        ) : (
          <>
            <header className="public-restaurant-page-header">
              <div className="public-restaurant-header-left">
                {/* Restaurant owners can use local or Supabase-hosted logos, so keep this image host-agnostic. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={logoUrl}
                  alt={getTranslation("public.restaurantLogo", { restaurant: restaurant.name })}
                  className="public-restaurant-header-logo"
                  onError={() => setLogoUrl(DEFAULT_RESTAURANT_LOGO)}
                />
              </div>

              <RestaurantAutoFitName name={restaurant.name} />

              <button
                type="button"
                className="public-restaurant-language"
                aria-label={`${getTranslation("language.label")}: ${localeConfig[nextLanguage].nativeLabel}`}
                onClick={() => setLanguage(nextLanguage)}
              >
                <Globe2 aria-hidden="true" />
                <span>{languageLabel}</span>
              </button>
            </header>

            <section className="public-restaurant-hero" aria-labelledby="restaurant-page-title">
              <div className="public-restaurant-hero-media">
                {safePrimaryImageUrl && !heroImageFailed && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={safePrimaryImageUrl}
                    alt={getTranslation("public.diningSpace", { restaurant: restaurant.name })}
                    className={`public-restaurant-hero-image${heroImageLoaded ? " public-restaurant-hero-image-loaded" : ""}`}
                    ref={heroImageRef}
                    onLoad={() => setHeroImageLoaded(true)}
                    onError={() => {
                      setHeroImageFailed(true)
                      setHeroImageLoaded(false)
                    }}
                  />
                )}
              </div>
              {(!safePrimaryImageUrl || heroImageFailed) && <ReserveviaPhysicsCover slug={restaurant.slug} />}
              <div className="public-restaurant-hero-shade" />

              {whatsappNumber || phoneNumber ? (
                <div className="public-restaurant-contact-actions">
                  {whatsappNumber && (
                    <ContactButton
                      href={`https://wa.me/${whatsappNumber}`}
                      label={getTranslation("card.whatsappButton")}
                      variant="whatsapp"
                    >
                      <MessageCircle className="public-restaurant-whatsapp-glyph" aria-hidden="true" />
                    </ContactButton>
                  )}
                  {phoneNumber && (
                    <ContactButton
                      href={`tel:${phoneNumber}`}
                      label={getTranslation("card.callButton")}
                      variant="phone"
                    >
                      <Phone aria-hidden="true" />
                    </ContactButton>
                  )}
                </div>
              ) : null}

              <div className="public-restaurant-hero-content">
                <h1 id="restaurant-page-title" className="public-restaurant-hero-name-heading">
                  <RestaurantAutoFitName name={restaurant.name} variant="hero" />
                </h1>
                <span className="public-restaurant-title-rule" aria-hidden="true" />
                {restaurant.description && (
                  <button
                    type="button"
                    className={`public-restaurant-description-toggle${descriptionExpanded ? " public-restaurant-description-toggle-expanded" : ""}`}
                    onClick={() => descriptionCanExpand && setDescriptionExpanded((expanded) => !expanded)}
                    aria-expanded={descriptionCanExpand ? descriptionExpanded : undefined}
                  >
                    <span ref={descriptionRef} className="public-restaurant-page-description">{restaurant.description}</span>
                    {descriptionCanExpand && <ChevronDown className="public-restaurant-description-chevron" aria-hidden="true" />}
                  </button>
                )}

                <div className="public-restaurant-details" aria-label={getTranslation("public.restaurantDetails", { restaurant: restaurant.name })}>
                  {visibility.cuisine && restaurant.cuisine && <DetailCard icon={<Leaf />} label={getTranslation("card.cuisine")} value={restaurant.cuisine} />}
                  {visibility.hours && restaurant.hours && <DetailCard icon={<Clock3 />} label={getTranslation("card.hours")} value={restaurant.hours} />}
                  {visibility.atmosphere && restaurant.atmosphere && <DetailCard icon={<Waves />} label={getTranslation("card.atmosphere")} value={restaurant.atmosphere} />}
                </div>

                {visibility.reserve && restaurant.reservationEnabled && (
                  <RecentReservation
                    restaurantSlug={restaurant.slug}
                    restaurantName={restaurant.name}
                    customerManagementToken={reservationToken}
                    triggerOnly
                    showTriggerStatus
                    triggerClassName="public-restaurant-reserve public-restaurant-page-reserve"
                    triggerLabel={getTranslation("card.editReservation")}
                    triggerIcon={null}
                    triggerFallback={(
                      <Link href={reserveHref} onClick={handleReserveClick} className="public-restaurant-reserve public-restaurant-page-reserve">
                        <span>{getTranslation("card.reserveButton")}</span>
                        <ArrowRight aria-hidden="true" />
                      </Link>
                    )}
                    triggerFallbackWithStatus={(statusBadge, status) => (
                      <Link href={reserveHref} onClick={handleReserveClick} className="public-restaurant-reserve public-restaurant-page-reserve recent-reservation-trigger-fallback-button">
                        <span>{getTranslation("card.reserveButton")}</span>
                        {statusBadge}
                        {status !== "cancelled" && <ArrowRight aria-hidden="true" />}
                      </Link>
                    )}
                  />
                )}

                <nav className="public-restaurant-bottom-nav" aria-label={getTranslation("public.restaurantLinks")}>
                  <BottomAction
                    href={restaurant.menuUrl}
                    label={getTranslation("card.menuButton")}
                    icon={<Utensils />}
                  />
                  <BottomAction
                    href={restaurant.locationUrl}
                    label={getTranslation("card.locationButton")}
                    icon={<MapPin />}
                  />
                  <BottomAction
                    href={restaurant.eventsUrl}
                    label={getTranslation("card.eventsButton")}
                    icon={<CalendarDays />}
                  />
                </nav>

                {!preview && restaurant.isClaimable && restaurant.restaurantId && (
                  <div className="public-restaurant-claim">
                    <span>{getTranslation("public.claimBusiness")}</span>
                    <Link href={`/claim/${encodeURIComponent(restaurant.restaurantId)}`}>
                      {getTranslation("public.claimBusinessAction")} <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                )}

                {preview && <p className="public-restaurant-preview-note">{getTranslation("public.previewNote")}</p>}
              </div>
            </section>

            {(restaurant.showReserveviaBranding || visibleSocialLinks.length > 0) && (
              <div className={`public-restaurant-footer${visibleSocialLinks.length === 0 ? " public-restaurant-footer-branding-only" : restaurant.showReserveviaBranding ? "" : " public-restaurant-footer-social-only"}`}>
                {restaurant.showReserveviaBranding && (
                  <a href={getPlatformUrl("/")} className="public-restaurant-branding">{getTranslation("public.poweredBy")}</a>
                )}

                {visibleSocialLinks.length > 0 && (
                  <nav className="public-restaurant-social" aria-label={`${restaurant.name} social media`}>
                    {visibleSocialLinks.map(({ platform, label, Icon }) => (
                      <a
                        key={platform}
                        href={socialLinks[platform]}
                        className="public-restaurant-social-link"
                        target="_blank"
                        rel="noreferrer noopener"
                        aria-label={`${restaurant.name} ${label}`}
                        title={label}
                      >
                        <Icon aria-hidden="true" />
                      </a>
                    ))}
                  </nav>
                )}
              </div>
            )}
          </>
        )}
        </div>
      </PublicRestaurantDeviceFrame>
    </main>
  )
}
