"use client"

import Link from "next/link"
import { useState } from "react"
import { ArrowRight, CalendarDays, Clock3, Loader2, MapPin, UsersRound } from "lucide-react"
import { useLanguage } from "@/context/language-context"
import { getPlatformUrl } from "@/lib/platform-urls"

interface ReservationConfirmationProps {
  restaurantName: string
  restaurantSlug?: string
  date: string
  time: string
  partySize: string
}

export function ReservationConfirmation({ restaurantName, restaurantSlug, date, time, partySize }: ReservationConfirmationProps) {
  const { currentLang, getTranslation } = useLanguage()
  const [isManaging, setIsManaging] = useState(false)
  const restaurantHomeHref = restaurantSlug
    ? `/r/${encodeURIComponent(restaurantSlug)}?lang=${currentLang}`
    : "/"
  const browseRestaurantsHref = getPlatformUrl(`/restaurants?lang=${encodeURIComponent(currentLang)}`)

  return (
    <section className="reservation-confirmation-card" aria-labelledby="reservation-confirmation-title">
      <div className="reservation-confirmation-badge" aria-hidden="true">
        <Clock3 />
      </div>
      <div className="reservation-confirmation-status" role="status">
        <Clock3 aria-hidden="true" />
        {getTranslation("reserve.confirmation.pendingLabel")}
      </div>
      <h1 id="reservation-confirmation-title">{getTranslation("reserve.confirmation.title")}</h1>
      <p className="reservation-confirmation-subtitle">
        {getTranslation("reserve.confirmation.subtitle")}
      </p>
      <p className="reservation-confirmation-note">
        {getTranslation("reserve.confirmation.note", { restaurant: restaurantName })}
      </p>
      <div className="reservation-confirmation-details">
        <div>
          <span><MapPin aria-hidden="true" />{getTranslation("reserve.confirmation.restaurant")}</span>
          <strong>{restaurantName}</strong>
        </div>
        <div>
          <span><CalendarDays aria-hidden="true" />{getTranslation("reserve.confirmation.date")}</span>
          <strong>{date}</strong>
        </div>
        <div>
          <span><Clock3 aria-hidden="true" />{getTranslation("reserve.confirmation.time")}</span>
          <strong>{time}</strong>
        </div>
        <div>
          <span><UsersRound aria-hidden="true" />{getTranslation("reserve.confirmation.party")}</span>
          <strong>{getTranslation("reserve.step2.summaryPartyOf", { count: partySize })}</strong>
        </div>
      </div>
      <div className="reservation-confirmation-actions">
        <Link
          href={restaurantHomeHref}
          aria-busy={isManaging}
          aria-disabled={isManaging}
          className={`consumer-state-button consumer-state-button-primary${isManaging ? " consumer-state-button-loading" : ""}`}
          onClick={(event) => {
            if (isManaging) {
              event.preventDefault()
              return
            }
            setIsManaging(true)
          }}
        >
          {isManaging ? <><Loader2 aria-hidden="true" className="animate-spin" />{getTranslation("common.loading")}</> : <>{getTranslation("reserve.confirmation.manageButton")}<ArrowRight aria-hidden="true" /></>}
        </Link>
        <Link href={browseRestaurantsHref} className="consumer-state-button consumer-state-button-secondary">
          {getTranslation("public.browseRestaurants")}
        </Link>
      </div>
    </section>
  )
}
