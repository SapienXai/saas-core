"use client"

import Link from "next/link"
import Image from "next/image"
import { ArrowRight, CalendarDays, Facebook, Globe2, Instagram, MapPin, MessageCircle, Music2, Phone, Twitter, Utensils, Youtube } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { useLanguage } from "@/context/language-context"
import { formatDate as formatLocalizedDate, type SupportedLanguage } from "@/i18n"
import { normalizeSocialLinks, type PublicRestaurantProfile, type SocialPlatform } from "@/lib/restaurant-profile"
import { getPlatformUrl } from "@/lib/platform-urls"

interface RestaurantCardProps {
  restaurant: PublicRestaurantProfile
}

const PUBLIC_SOCIAL_PLATFORMS: ReadonlyArray<{ platform: SocialPlatform; label: string; Icon: LucideIcon }> = [
  { platform: "instagram", label: "Instagram", Icon: Instagram },
  { platform: "facebook", label: "Facebook", Icon: Facebook },
  { platform: "tiktok", label: "TikTok", Icon: Music2 },
  { platform: "youtube", label: "YouTube", Icon: Youtube },
  { platform: "x", label: "X", Icon: Twitter },
  { platform: "website", label: "Website", Icon: Globe2 },
]

function PublicAction({
  href,
  label,
  icon,
  external = true,
}: {
  href: string | null
  label: string
  icon: ReactNode
  external?: boolean
}) {
  if (!href) {
    return (
      <span className="public-restaurant-card-action public-restaurant-card-action-disabled" aria-disabled="true">
        {icon}
        <span>{label}</span>
      </span>
    )
  }

  const props = external ? { target: "_blank", rel: "noreferrer noopener" } : {}
  return (
    <a href={href} className="public-restaurant-card-action" {...props}>
      {icon}
      <span>{label}</span>
    </a>
  )
}

function parseYYYYMMDD(value: string | null | undefined) {
  if (!value) return null
  const [year, month, day] = value.split("-").map(Number)
  if (!year || !month || !day) return null

  const date = new Date(year, month - 1, day)
  date.setHours(0, 0, 0, 0)
  return date
}

function getReservationOpeningLabel(value: string | null, lang: SupportedLanguage, label: (date: string) => string) {
  const openingDate = parseYYYYMMDD(value)
  if (!openingDate) return null

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (openingDate <= today) return null

  const formattedDate = formatLocalizedDate(openingDate, lang, {
    day: "numeric",
    month: "long",
  })

  return label(formattedDate)
}

function getVisibleLocation(value: string | null) {
  if (!value || /^https?:\/\//i.test(value.trim())) return null
  return value.trim()
}

export function RestaurantCard({ restaurant }: RestaurantCardProps) {
  const { getTranslation, currentLang } = useLanguage()
  const reservationOpeningLabel = getReservationOpeningLabel(
    restaurant.reservationStartDate,
    currentLang,
    (date) => getTranslation("card.reservationOpening", { date }),
  )
  const reserveButtonLabel = reservationOpeningLabel || getTranslation("card.reserveButton")
  const visibility = restaurant.visibility
  const phoneNumber = visibility.phone ? restaurant.phone : null
  const whatsappNumber = visibility.whatsapp ? (restaurant.whatsapp || (visibility.phone ? restaurant.phone : null))?.replace(/\D/g, "") : null
  const locationHref = restaurant.locationUrl || (
    visibility.location && restaurant.location
      ? `https://maps.google.com/?q=${encodeURIComponent(restaurant.location)}`
      : null
  )
  const visibleLocation = visibility.location ? getVisibleLocation(restaurant.location) : null
  const restaurantHref = `/r/${encodeURIComponent(restaurant.slug)}`
  const publicRestaurantHref = `${restaurantHref}?lang=${encodeURIComponent(currentLang)}`
  const socialLinks = normalizeSocialLinks(restaurant.socialLinks)
  const visibleSocialLinks = PUBLIC_SOCIAL_PLATFORMS.filter(({ platform }) => Boolean(socialLinks[platform]))

  return (
    <article className="public-restaurant-card">
      <Link href={restaurantHref} className="public-restaurant-card-image-link" aria-label={getTranslation("public.viewRestaurant", { restaurant: restaurant.name })}>
        {restaurant.primaryImageUrl ? (
          <Image
            src={restaurant.primaryImageUrl}
            alt={getTranslation("public.diningSpace", { restaurant: restaurant.name })}
            className="public-restaurant-card-image"
            fill
            unoptimized
            sizes="(max-width: 699px) 100vw, (max-width: 1099px) 50vw, 33vw"
            loading="lazy"
          />
        ) : (
          <div className="public-restaurant-card-image public-restaurant-card-image-empty" aria-hidden="true">
            <span>{restaurant.name.slice(0, 1).toUpperCase()}</span>
          </div>
        )}
        <div className="public-restaurant-card-image-shade" />
      </Link>

      {restaurant.logoUrl && (
        <Image
          src={restaurant.logoUrl}
          alt={getTranslation("public.restaurantLogo", { restaurant: restaurant.name })}
          className="public-restaurant-card-logo"
          width={64}
          height={64}
          unoptimized
        />
      )}

      <div className="public-restaurant-card-overlay">
        <div className="public-restaurant-card-top">
          {(phoneNumber || whatsappNumber) && (
            <div className="public-restaurant-card-contact-actions" aria-label={getTranslation("public.contactOptions", { restaurant: restaurant.name })}>
              {whatsappNumber && (
                <a
                  href={`https://wa.me/${whatsappNumber}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="public-restaurant-card-contact public-restaurant-card-contact-whatsapp"
                  aria-label={getTranslation("public.messageOnWhatsapp", { restaurant: restaurant.name })}
                >
                  <MessageCircle aria-hidden="true" />
                </a>
              )}
              {phoneNumber && (
                <a
                  href={`tel:${phoneNumber}`}
                  className="public-restaurant-card-contact public-restaurant-card-contact-phone"
                  aria-label={getTranslation("public.callRestaurant", { restaurant: restaurant.name })}
                >
                  <Phone aria-hidden="true" />
                </a>
              )}
            </div>
          )}
        </div>

        <div className="public-restaurant-card-bottom">
          <div className="public-restaurant-card-title">
            <p className="public-restaurant-card-eyebrow">{getTranslation("public.reserveviaDining")}</p>
            <h2><Link href={restaurantHref}>{restaurant.name}</Link></h2>
            {visibility.description && restaurant.description && <p>{restaurant.description}</p>}
          </div>

          <div className="public-restaurant-card-info" aria-label={getTranslation("public.restaurantDetails", { restaurant: restaurant.name })}>
            {visibility.cuisine && restaurant.cuisine && <div><span>{getTranslation("card.cuisine")}</span><strong>{restaurant.cuisine}</strong></div>}
            {visibility.hours && restaurant.hours && <div><span>{getTranslation("card.hours")}</span><strong>{restaurant.hours}</strong></div>}
            {visibility.atmosphere && restaurant.atmosphere && <div><span>{getTranslation("card.atmosphere")}</span><strong>{restaurant.atmosphere}</strong></div>}
            {visibleLocation && <div><span>{getTranslation("card.location")}</span><strong>{visibleLocation}</strong></div>}
          </div>

          <div className="public-restaurant-card-actions">
            {visibility.reserve && restaurant.reservationEnabled && (
              <Link
                href={publicRestaurantHref}
                className="public-restaurant-card-reserve"
                aria-label={getTranslation("card.reserveAt", { action: reserveButtonLabel, restaurant: restaurant.name })}
              >
                <span>{reserveButtonLabel}</span>
                <ArrowRight aria-hidden="true" />
              </Link>
            )}

            <div className="public-restaurant-card-secondary-actions">
              <PublicAction href={restaurant.menuUrl} label={getTranslation("card.menuButton")} icon={<Utensils aria-hidden="true" />} />
              <PublicAction href={locationHref} label={getTranslation("card.locationButton")} icon={<MapPin aria-hidden="true" />} />
              <PublicAction href={restaurant.eventsUrl} label={getTranslation("card.eventsButton")} icon={<CalendarDays aria-hidden="true" />} />
            </div>
          </div>

          {(restaurant.showReserveviaBranding || visibleSocialLinks.length > 0) && (
            <div className={`public-restaurant-card-footer${visibleSocialLinks.length === 0 ? " public-restaurant-card-footer-branding-only" : restaurant.showReserveviaBranding ? "" : " public-restaurant-card-footer-social-only"}`}>
              {restaurant.showReserveviaBranding && (
                <a href={getPlatformUrl("/")} className="public-restaurant-card-branding">
                  {getTranslation("public.poweredBy")}
                </a>
              )}

              {visibleSocialLinks.length > 0 && (
                <div className="public-restaurant-card-social" aria-label={`${restaurant.name} ${getTranslation("card.socialMedia")}`}>
                  {visibleSocialLinks.map(({ platform, label, Icon }) => (
                    <a
                      key={platform}
                      href={socialLinks[platform]}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="public-restaurant-card-social-link"
                      aria-label={getTranslation("public.socialProfile", { restaurant: restaurant.name, profile: label })}
                      title={label}
                    >
                      <Icon aria-hidden="true" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}
