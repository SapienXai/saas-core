"use client"

import Image from "next/image"
import Link from "next/link"
import { createPortal } from "react-dom"
import { ArrowRight, CalendarDays, Check, Facebook, Globe2, Instagram, MapPin, MessageCircle, Music2, Phone, Ticket, Utensils, X, Youtube } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { FocusEvent, ReactNode } from "react"

import { useLanguage } from "@/context/language-context"
import { getSafeRestaurantAssetUrl } from "@/lib/legacy-assets"
import { normalizeSocialLinks } from "@/lib/restaurant-profile"
import type { PublicBrand } from "@/lib/services/public/brand-service"

export type RestaurantResultAvailabilityStatus = "available" | "nearby" | "unavailable" | "error" | "loading"

export type RestaurantResultAvailability = {
  status: RestaurantResultAvailabilityStatus
  slots: string[]
  requestedTimeAvailable: boolean
}

export type RestaurantResultSearch = {
  date: string
  time: string
  guests: number
}

type RestaurantResultCardProps = {
  location: PublicBrand["locations"][number]
  availability?: RestaurantResultAvailability
  loading: boolean
  error: boolean
  submittedSearch: RestaurantResultSearch
  brandReturnHref: string
  onLocationFocus?: () => void
  onLocationBlur?: () => void
}

function formatLocationText(value: string | null | undefined) {
  return value?.replace(/\+/g, " ").trim() || ""
}

function locationLabel(location: PublicBrand["locations"][number]) {
  return location.address.formatted || formatLocationText(location.location) || location.address.locality || location.address.region || ""
}

function publicRestaurantHref(slug: string, from: string) {
  return `/r/${encodeURIComponent(slug)}?${new URLSearchParams({ from }).toString()}`
}

function reservationHref(slug: string, search: RestaurantResultSearch, time: string, from: string) {
  const params = new URLSearchParams({
    restaurantSlug: slug,
    date: search.date,
    time,
    guests: String(search.guests),
    from,
  })
  return `/reserve?${params.toString()}`
}

function statusKey(status: RestaurantResultAvailabilityStatus) {
  if (status === "available") return "public.brand.available"
  if (status === "nearby") return "public.brand.nearby"
  if (status === "loading") return "public.brand.checking"
  if (status === "error") return "public.brand.tryAgain"
  return "public.brand.unavailable"
}

function ResultStatus({ status }: { status: RestaurantResultAvailabilityStatus }) {
  const { getTranslation } = useLanguage()
  return (
    <span className={`public-brand-result-status is-${status}`}>
      {status === "available" ? <Check aria-hidden="true" /> : <span className="public-brand-result-status-dot" aria-hidden="true" />}
      {getTranslation(statusKey(status))}
    </span>
  )
}

function ResultMedia({ location, href, variant, onOpenLinks }: { location: PublicBrand["locations"][number]; href: string; variant: "card" | "list"; onOpenLinks?: () => void }) {
  const { getTranslation } = useLanguage()
  const cover = getSafeRestaurantAssetUrl(location.primaryImageUrl)
  const content = (
    <>
      {cover ? <Image src={cover} alt={getTranslation("public.diningSpace", { restaurant: location.name })} fill sizes={variant === "card" ? "(max-width: 760px) 100vw, 50vw" : "112px"} unoptimized /> : <span aria-hidden="true">{location.name.slice(0, 1).toUpperCase()}</span>}
      <span className="public-brand-result-media-shade" aria-hidden="true" />
    </>
  )
  const className = `public-brand-result-media public-brand-result-media--${variant}`
  const ariaLabel = getTranslation("public.contactOptions", { restaurant: location.name })
  if (onOpenLinks) {
    return <button type="button" className={className} onClick={onOpenLinks} aria-label={ariaLabel}>{content}</button>
  }
  return <Link href={href} className={className} aria-label={getTranslation("public.viewRestaurant", { restaurant: location.name })}>{content}</Link>
}

function ResultMeta({ location }: { location: PublicBrand["locations"][number] }) {
  const place = locationLabel(location)
  const parts = [locationLabel(location), location.cuisine, location.atmosphere].filter(Boolean)
  return (
    <p className="public-brand-result-meta">
      {place ? <MapPin aria-hidden="true" /> : null}
      <span>{parts.join(" · ")}</span>
    </p>
  )
}

function ResultHeading({ location, href, status, onOpenLinks }: { location: PublicBrand["locations"][number]; href: string; status: RestaurantResultAvailabilityStatus; onOpenLinks?: () => void }) {
  const { getTranslation } = useLanguage()
  return (
    <div className="public-brand-result-heading">
      <div>
        <h3>{onOpenLinks ? <button type="button" className="public-brand-result-name-button" onClick={onOpenLinks}>{location.name}</button> : <Link href={href}>{location.name}</Link>}</h3>
        <ResultMeta location={location} />
      </div>
      <div className="public-brand-result-heading-actions">
        <ResultStatus status={status} />
        {onOpenLinks ? <button type="button" className="public-brand-result-details-trigger" onClick={onOpenLinks} aria-label={getTranslation("public.contactOptions", { restaurant: location.name })} title={getTranslation("public.contactOptions", { restaurant: location.name })}><ArrowRight aria-hidden="true" /></button> : null}
      </div>
    </div>
  )
}

function ResultTimes({ location, availability, submittedSearch, brandReturnHref, maxSlots = 4 }: { location: PublicBrand["locations"][number]; availability?: RestaurantResultAvailability; submittedSearch: RestaurantResultSearch; brandReturnHref: string; maxSlots?: number }) {
  const { getTranslation } = useLanguage()
  const slots = availability?.slots || []
  return (
    <div className="public-brand-result-times" aria-label={getTranslation("public.brand.availableTimes", { location: location.name })}>
      {slots.length ? slots.slice(0, maxSlots).map((slot) => (
        <Link key={slot} href={reservationHref(location.slug, submittedSearch, slot, brandReturnHref)} className={slot === submittedSearch.time ? "is-exact" : ""}>{slot}</Link>
      )) : <span className="public-brand-result-no-times">{getTranslation("public.brand.noTimes")}</span>}
    </div>
  )
}

function ResultReserveLink({ location, availability, submittedSearch, brandReturnHref }: { location: PublicBrand["locations"][number]; availability?: RestaurantResultAvailability; submittedSearch: RestaurantResultSearch; brandReturnHref: string }) {
  const { getTranslation } = useLanguage()
  const time = availability?.slots?.[0] || submittedSearch.time
  return (
    <Link href={reservationHref(location.slug, submittedSearch, time, brandReturnHref)} className="public-brand-result-reserve-link">
      <span>{getTranslation("public.brand.reserve")}</span>
      <ArrowRight aria-hidden="true" />
    </Link>
  )
}

function getStatus({ availability, loading, error }: Pick<RestaurantResultCardProps, "availability" | "loading" | "error">): RestaurantResultAvailabilityStatus {
  return availability?.status || (loading ? "loading" : error ? "error" : "unavailable")
}

function handleResultBlur(event: FocusEvent<HTMLElement>, onLocationBlur?: () => void) {
  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onLocationBlur?.()
}

type ResultLink = {
  label: string
  href: string
  icon: ReactNode
  description?: string
  external?: boolean
  newTab?: boolean
}

function safeHttpUrl(value: string | null | undefined) {
  if (!value?.trim()) return null
  try {
    const url = new URL(value.trim())
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null
  } catch {
    return null
  }
}

function locationMapHref(location: PublicBrand["locations"][number]) {
  const storedUrl = safeHttpUrl(location.locationUrl)
  if (storedUrl) return storedUrl
  if (typeof location.latitude === "number" && typeof location.longitude === "number") {
    return `https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`
  }
  return null
}

function whatsappHref(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, "") || ""
  return digits.length >= 7 ? `https://wa.me/${digits}` : null
}

function getResultLinks(location: PublicBrand["locations"][number], availability: RestaurantResultAvailability | undefined, submittedSearch: RestaurantResultSearch, brandReturnHref: string, getTranslation: ReturnType<typeof useLanguage>["getTranslation"]): ResultLink[] {
  const links: ResultLink[] = []
  const add = (link: ResultLink) => links.push(link)
  const reservationTime = availability?.slots?.[0] || submittedSearch.time
  if (location.reservationEnabled) {
    add({
      label: getTranslation("public.brand.reserve"),
      href: reservationHref(location.slug, submittedSearch, reservationTime, brandReturnHref),
      icon: <CalendarDays aria-hidden="true" />,
    })
  }

  const mapHref = locationMapHref(location)
  if (mapHref) add({ label: getTranslation("card.locationButton"), href: mapHref, icon: <MapPin aria-hidden="true" />, external: true, newTab: true })

  if (location.phone?.trim()) {
    add({ label: getTranslation("card.callButton"), href: `tel:${location.phone.trim()}`, description: location.phone.trim(), icon: <Phone aria-hidden="true" />, external: true })
  }

  const whatsappNumber = location.visibility.whatsapp ? location.whatsapp || (location.visibility.phone ? location.phone : null) : null
  const whatsappLink = whatsappHref(whatsappNumber)
  if (whatsappLink) add({ label: getTranslation("card.whatsappButton"), href: whatsappLink, description: whatsappNumber || undefined, icon: <MessageCircle aria-hidden="true" />, external: true, newTab: true })

  const menuHref = safeHttpUrl(location.menuUrl)
  if (menuHref) add({ label: getTranslation("card.menuButton"), href: menuHref, icon: <Utensils aria-hidden="true" />, external: true, newTab: true })

  const eventsHref = safeHttpUrl(location.eventsUrl)
  if (eventsHref) add({ label: getTranslation("card.eventsButton"), href: eventsHref, icon: <Ticket aria-hidden="true" />, external: true, newTab: true })

  const socialLinks = normalizeSocialLinks(location.socialLinks)
  const websiteHref = safeHttpUrl(location.officialWebsiteUrl || socialLinks.website)
  if (websiteHref) add({ label: "Website", href: websiteHref, icon: <Globe2 aria-hidden="true" />, external: true, newTab: true })

  const socialItems: Array<{ key: "instagram" | "facebook" | "tiktok" | "youtube" | "x"; label: string; icon: ReactNode }> = [
    { key: "instagram", label: "Instagram", icon: <Instagram aria-hidden="true" /> },
    { key: "facebook", label: "Facebook", icon: <Facebook aria-hidden="true" /> },
    { key: "tiktok", label: "TikTok", icon: <Music2 aria-hidden="true" /> },
    { key: "youtube", label: "YouTube", icon: <Youtube aria-hidden="true" /> },
    { key: "x", label: "X", icon: <span aria-hidden="true">𝕏</span> },
  ]
  for (const item of socialItems) {
    const href = safeHttpUrl(socialLinks[item.key])
    if (href) add({ label: item.label, href, icon: item.icon, external: true, newTab: true })
  }

  add({
    label: getTranslation("public.viewRestaurant", { restaurant: location.name }),
    href: publicRestaurantHref(location.slug, brandReturnHref),
    icon: <Globe2 aria-hidden="true" />,
  })
  return links
}

function ResultLinksSheet({ location, links, onClose }: { location: PublicBrand["locations"][number]; links: ResultLink[]; onClose: () => void }) {
  const { getTranslation } = useLanguage()
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    closeButtonRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.body.style.overflow = previousOverflow
      previousActiveElement?.focus()
    }
  }, [onClose])

  if (typeof document === "undefined") return null
  const title = getTranslation("public.contactOptions", { restaurant: location.name })
  return createPortal(
    <div className="public-brand-result-links-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <aside className="public-brand-result-links-panel" role="dialog" aria-modal="true" aria-labelledby="public-brand-result-links-title">
        <div className="public-brand-result-links-header">
          <div>
            <p className="public-brand-result-links-eyebrow">{getTranslation("public.brand.directBooking")}</p>
            <h2 id="public-brand-result-links-title">{location.name}</h2>
            <p>{title}</p>
          </div>
          <button ref={closeButtonRef} type="button" className="public-brand-result-links-close" onClick={onClose} aria-label={getTranslation("common.close")} title={getTranslation("common.close")}><X aria-hidden="true" /></button>
        </div>
        <nav className="public-brand-result-links-list" aria-label={title}>
          {links.map((link) => {
            const content = <><span className="public-brand-result-links-icon">{link.icon}</span><span className="public-brand-result-links-copy"><strong>{link.label}</strong>{link.description ? <small>{link.description}</small> : null}</span><ArrowRight className="public-brand-result-links-arrow" aria-hidden="true" /></>
            return link.external
              ? <a key={`${link.label}-${link.href}`} href={link.href} {...(link.newTab ? { target: "_blank", rel: "noreferrer noopener" } : {})}>{content}</a>
              : <Link key={`${link.label}-${link.href}`} href={link.href}>{content}</Link>
          })}
        </nav>
      </aside>
    </div>,
    document.body,
  )
}

export function RestaurantCardViewCard(props: RestaurantResultCardProps) {
  const { location, availability, loading, error, submittedSearch, brandReturnHref, onLocationFocus, onLocationBlur } = props
  const { getTranslation } = useLanguage()
  const href = publicRestaurantHref(location.slug, brandReturnHref)
  const status = getStatus({ availability, loading, error })
  const [isLinksOpen, setIsLinksOpen] = useState(false)
  const openLinks = () => setIsLinksOpen(true)
  const closeLinks = () => setIsLinksOpen(false)
  const links = getResultLinks(location, availability, submittedSearch, brandReturnHref, getTranslation)
  return (
    <article
      id={location.slug}
      className="public-brand-result-card public-brand-result-card--card"
      onMouseEnter={onLocationFocus}
      onMouseLeave={onLocationBlur}
      onFocus={onLocationFocus}
      onBlur={(event) => handleResultBlur(event, onLocationBlur)}
    >
      <ResultMedia location={location} href={href} variant="card" onOpenLinks={openLinks} />
      <div className="public-brand-result-body">
        <ResultHeading location={location} href={href} status={status} />
        {location.description ? <p className="public-brand-result-description">{location.description}</p> : null}
        <div className="public-brand-result-actions">
          <ResultTimes location={location} availability={availability} submittedSearch={submittedSearch} brandReturnHref={brandReturnHref} />
          <ResultReserveLink location={location} availability={availability} submittedSearch={submittedSearch} brandReturnHref={brandReturnHref} />
        </div>
      </div>
      {isLinksOpen ? <ResultLinksSheet location={location} links={links} onClose={closeLinks} /> : null}
      <span className="sr-only">{getTranslation("public.viewRestaurant", { restaurant: location.name })}</span>
    </article>
  )
}

export function RestaurantListViewItem(props: RestaurantResultCardProps) {
  const { location, availability, loading, error, submittedSearch, brandReturnHref, onLocationFocus, onLocationBlur } = props
  const { getTranslation } = useLanguage()
  const href = publicRestaurantHref(location.slug, brandReturnHref)
  const status = getStatus({ availability, loading, error })
  const [isLinksOpen, setIsLinksOpen] = useState(false)
  const openLinks = () => setIsLinksOpen(true)
  const closeLinks = () => setIsLinksOpen(false)
  const links = getResultLinks(location, availability, submittedSearch, brandReturnHref, getTranslation)
  return (
    <article
      id={location.slug}
      className="public-brand-result-card public-brand-result-card--list"
      onMouseEnter={onLocationFocus}
      onMouseLeave={onLocationBlur}
      onFocus={onLocationFocus}
      onBlur={(event) => handleResultBlur(event, onLocationBlur)}
    >
      <ResultMedia location={location} href={href} variant="list" onOpenLinks={openLinks} />
      <div className="public-brand-result-body">
        <ResultHeading location={location} href={href} status={status} onOpenLinks={openLinks} />
        <div className="public-brand-result-actions">
          <ResultTimes location={location} availability={availability} submittedSearch={submittedSearch} brandReturnHref={brandReturnHref} maxSlots={3} />
        </div>
      </div>
      {isLinksOpen ? <ResultLinksSheet location={location} links={links} onClose={closeLinks} /> : null}
    </article>
  )
}
