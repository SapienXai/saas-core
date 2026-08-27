"use client"

import { useState } from "react"
import Link from "next/link"
import { useLanguage } from "@/context/language-context"
import type { TranslationKey } from "@/i18n"

type FeatureVisualItem = {
  label: string
  meta: string
  value: string
  mark: string
  tone: "green" | "blue" | "pink" | "yellow" | "purple"
}

type Feature = {
  id: string
  label: string
  title: string
  description: string
  visual: {
    badge: string
    title: string
    metric: string
    footer: string
    floating: string
    items: FeatureVisualItem[]
  }
}

const features: Feature[] = [
  {
    id: "online-bookings",
    label: "Online bookings",
    title: "Turn every channel into a direct booking.",
    description: "Commission-free reservations from your website, social links, and booking channels. Get more direct reservations without per-cover fees.",
    visual: {
      badge: "Direct channels",
      title: "New reservations",
      metric: "+24%",
      footer: "3 channels connected",
      floating: "Direct booking",
      items: [
        { label: "Social links", meta: "2 guests · 7:15 PM", value: "New", mark: "◎", tone: "pink" },
        { label: "Booking platforms", meta: "4 guests · 9:15 PM", value: "New", mark: "↗", tone: "blue" },
        { label: "Your website", meta: "3 guests · 12:15 PM", value: "Confirmed", mark: "✓", tone: "green" },
      ],
    },
  },
  {
    id: "manage-reservations",
    label: "Manage reservations",
    title: "Keep every table and guest in sync.",
    description: "See arrivals, walk-ins, waitlist, and guest notes in one calm view so your team always knows what is next.",
    visual: {
      badge: "Today at a glance",
      title: "Reservation list",
      metric: "18",
      footer: "Reservations today",
      floating: "Team-ready view",
      items: [
        { label: "Nolan Philips", meta: "2 guests · Table 3", value: "Confirmed", mark: "✓", tone: "green" },
        { label: "Martin Herwitz", meta: "4 guests · Table 7", value: "Seated", mark: "●", tone: "blue" },
        { label: "Anna Gutierrez", meta: "3 guests · Waitlist", value: "Pending", mark: "+", tone: "yellow" },
      ],
    },
  },
  {
    id: "remind-guests",
    label: "Remind guests",
    title: "Reduce no-shows before they happen.",
    description: "Send timely reminders and keep guests informed without adding another task to your team's day.",
    visual: {
      badge: "Guest messaging",
      title: "Reminder schedule",
      metric: "92%",
      footer: "Guests reached on time",
      floating: "Less chasing",
      items: [
        { label: "Tomorrow's bookings", meta: "Reminder sent · 16 guests", value: "Done", mark: "✓", tone: "green" },
        { label: "Dinner service", meta: "Reminder queued · 7:00 PM", value: "Queued", mark: "◷", tone: "yellow" },
        { label: "Guest reply", meta: "Table for 4 · Confirmed", value: "Replied", mark: "↗", tone: "purple" },
      ],
    },
  },
  {
    id: "manage-tables",
    label: "Manage tables",
    title: "Make the floor plan work for your service.",
    description: "Move tables, seat guests, and see what is available at a glance as the room changes throughout the day.",
    visual: {
      badge: "Live floor plan",
      title: "Main dining",
      metric: "68%",
      footer: "Floor capacity tonight",
      floating: "Room in control",
      items: [
        { label: "Table 08", meta: "2 guests · Main dining", value: "Available", mark: "○", tone: "green" },
        { label: "Table 12", meta: "4 guests · Dinner", value: "Reserved", mark: "◇", tone: "pink" },
        { label: "Table 16", meta: "6 guests · Patio", value: "Seated", mark: "●", tone: "blue" },
      ],
    },
  },
  {
    id: "build-guest-database",
    label: "Build guest database",
    title: "Turn every visit into a relationship.",
    description: "Keep guest notes, preferences, and visit history ready for the next conversation and the next great experience.",
    visual: {
      badge: "Guest profile",
      title: "Allison Gouse",
      metric: "12",
      footer: "Visits remembered",
      floating: "Know your guests",
      items: [
        { label: "Guest preference", meta: "Quiet table · Window seat", value: "Saved", mark: "♥", tone: "pink" },
        { label: "Last visit", meta: "14 June · Table for 2", value: "Logged", mark: "↗", tone: "purple" },
        { label: "Birthday", meta: "Coming up in 8 days", value: "Noted", mark: "★", tone: "yellow" },
      ],
    },
  },
  {
    id: "promote-your-brand",
    label: "Promote your brand",
    title: "Fill more tables with your own audience.",
    description: "Share your restaurant, collect direct bookings, and build demand you can bring back without relying on third-party platforms.",
    visual: {
      badge: "Brand reach",
      title: "This week's bookings",
      metric: "+31%",
      footer: "Direct bookings this week",
      floating: "Your audience, growing",
      items: [
        { label: "Social profile", meta: "48 booking visits", value: "+18%", mark: "◎", tone: "pink" },
        { label: "Restaurant profile", meta: "31 booking visits", value: "+12%", mark: "↗", tone: "blue" },
        { label: "Restaurant page", meta: "24 booking visits", value: "+9%", mark: "↗", tone: "green" },
      ],
    },
  },
]

const featureCopyKeys: Array<{
  label: TranslationKey
  title: TranslationKey
  description: TranslationKey
  badge: TranslationKey
  visualTitle: TranslationKey
  footer: TranslationKey
  floating: TranslationKey
}> = [
  { label: "marketing.featureOnlineBookings", title: "marketing.featureOnlineBookingsTitle", description: "marketing.featureOnlineBookingsDescription", badge: "marketing.directChannels", visualTitle: "marketing.newReservations", footer: "marketing.channelsConnected", floating: "marketing.directBooking" },
  { label: "marketing.featureManageReservations", title: "marketing.featureManageReservationsTitle", description: "marketing.featureManageReservationsDescription", badge: "marketing.todayAtGlance", visualTitle: "marketing.reservationList", footer: "marketing.reservationsToday", floating: "marketing.teamReadyView" },
  { label: "marketing.featureRemindGuests", title: "marketing.featureRemindGuestsTitle", description: "marketing.featureRemindGuestsDescription", badge: "marketing.guestMessaging", visualTitle: "marketing.reminderSchedule", footer: "marketing.guestsReachedOnTime", floating: "marketing.lessChasing" },
  { label: "marketing.featureManageTables", title: "marketing.featureManageTablesTitle", description: "marketing.featureManageTablesDescription", badge: "marketing.liveFloorPlan", visualTitle: "marketing.mainDining", footer: "marketing.floorCapacityTonight", floating: "marketing.roomInControl" },
  { label: "marketing.featureGuestDatabase", title: "marketing.featureGuestDatabaseTitle", description: "marketing.featureGuestDatabaseDescription", badge: "marketing.guestProfile", visualTitle: "marketing.allisonGouse", footer: "marketing.visitsRemembered", floating: "marketing.knowYourGuests" },
  { label: "marketing.featurePromoteBrand", title: "marketing.featurePromoteBrandTitle", description: "marketing.featurePromoteBrandDescription", badge: "marketing.brandReach", visualTitle: "marketing.thisWeeksBookings", footer: "marketing.directBookingsThisWeek", floating: "marketing.yourAudienceGrowing" },
]

const demoCopyKeys: Partial<Record<string, TranslationKey>> = {
  "Your website": "marketing.demoYourWebsite",
  "Social links": "marketing.heroChannelSocial",
  "Social profile": "marketing.heroChannelSocial",
  "Booking platforms": "marketing.heroChannelPlatforms",
  "Restaurant profile": "marketing.restaurantProfile",
  "2 guests · 7:15 PM": "marketing.demo2Guests715",
  "4 guests · 9:15 PM": "marketing.demo4Guests915",
  "3 guests · 12:15 PM": "marketing.demo3Guests1215",
  "2 guests · Table 3": "marketing.demo2GuestsTable3",
  "4 guests · Table 7": "marketing.demo4GuestsTable7",
  "3 guests · Waitlist": "marketing.demo3GuestsWaitlist",
  "Tomorrow's bookings": "marketing.demoTomorrowsBookings",
  "Reminder sent · 16 guests": "marketing.demoReminder16Guests",
  "Dinner service": "marketing.demoDinnerService",
  "Reminder queued · 7:00 PM": "marketing.demoReminder7Pm",
  "Guest reply": "marketing.demoGuestReply",
  "Table for 4 · Confirmed": "marketing.demoTable4Confirmed",
  "2 guests · Main dining": "marketing.demo2GuestsMainDining",
  "4 guests · Dinner": "marketing.demo4GuestsDinner",
  "6 guests · Patio": "marketing.demo6GuestsPatio",
  "Guest preference": "marketing.demoGuestPreference",
  "Quiet table · Window seat": "marketing.demoQuietWindow",
  "Last visit": "marketing.demoLastVisit",
  "14 June · Table for 2": "marketing.demo14JuneTable2",
  "Birthday": "marketing.demoBirthday",
  "Coming up in 8 days": "marketing.demoComing8Days",
  "48 booking visits": "marketing.demo48BookingVisits",
  "31 booking visits": "marketing.demo31BookingVisits",
  "24 booking visits": "marketing.demo24BookingVisits",
  "New": "marketing.demoNew",
  "Confirmed": "marketing.demoConfirmed",
  "Seated": "marketing.demoSeated",
  "Pending": "marketing.demoPending",
  "Done": "marketing.demoDone",
  "Queued": "marketing.demoQueued",
  "Replied": "marketing.demoReplied",
  "Available": "marketing.demoAvailable",
  "Reserved": "marketing.demoReserved",
  "Saved": "marketing.demoSaved",
  "Logged": "marketing.demoLogged",
  "Noted": "marketing.demoNoted",
}

export function MarketingFeatureTabs() {
  const { getTranslation } = useLanguage()
  const [activeIndex, setActiveIndex] = useState(0)
  const localizeDemoCopy = (value: string) => {
    const key = demoCopyKeys[value]
    return key ? getTranslation(key) : value
  }
  const localizedFeatures = features.map((feature, index) => {
    const copy = featureCopyKeys[index]
    return {
      ...feature,
      label: getTranslation(copy.label),
      title: getTranslation(copy.title),
      description: getTranslation(copy.description),
      visual: {
        ...feature.visual,
        badge: getTranslation(copy.badge),
        title: getTranslation(copy.visualTitle),
        footer: getTranslation(copy.footer),
        floating: getTranslation(copy.floating),
        items: feature.visual.items.map((item) => ({
          ...item,
          label: localizeDemoCopy(item.label),
          meta: localizeDemoCopy(item.meta),
          value: localizeDemoCopy(item.value),
        })),
      },
    }
  })
  const activeFeature = localizedFeatures[activeIndex]

  function moveTab(direction: number) {
    setActiveIndex((currentIndex) => (currentIndex + direction + features.length) % features.length)
  }

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault()
      moveTab(1)
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault()
      moveTab(-1)
    }

    if (event.key === "Home") {
      event.preventDefault()
      setActiveIndex(0)
    }

    if (event.key === "End") {
      event.preventDefault()
      setActiveIndex(features.length - 1)
    }
  }

  return (
    <>
      <div className="marketing-feature-tabs" role="tablist" aria-label={getTranslation("marketing.featuresAria")}>
        {localizedFeatures.map((feature, index) => (
          <button
            aria-controls="marketing-feature-panel"
            aria-selected={index === activeIndex}
            className={index === activeIndex ? "marketing-feature-tab marketing-feature-tab-active" : "marketing-feature-tab"}
            id={`marketing-feature-tab-${feature.id}`}
            key={feature.id}
            onClick={() => setActiveIndex(index)}
            onKeyDown={handleTabKeyDown}
            role="tab"
            tabIndex={index === activeIndex ? 0 : -1}
            type="button"
          >
            {feature.label}
          </button>
        ))}
      </div>

      <div
        aria-live="polite"
        className="marketing-feature-layout"
        id="marketing-feature-panel"
        key={activeFeature.id}
        role="tabpanel"
        aria-labelledby={`marketing-feature-tab-${activeFeature.id}`}
      >
        <div className="marketing-feature-copy">
          <p className="marketing-feature-kicker">{activeFeature.label}</p>
          <h3>{activeFeature.title}</h3>
          <p>{activeFeature.description}</p>
          <Link href="/#how-it-works" className="marketing-text-link marketing-feature-link">{getTranslation("marketing.learnMore")} <span aria-hidden="true">→</span></Link>
        </div>

        <div className={`marketing-feature-visual marketing-feature-detail-visual marketing-feature-detail-visual-${activeFeature.id}`} aria-label={`${activeFeature.label} preview`}>
          <div className="marketing-feature-detail-card">
            <div className="marketing-feature-detail-header">
              <span>{activeFeature.visual.badge}</span>
              <strong>{activeFeature.visual.title}</strong>
            </div>
            <div className="marketing-feature-detail-list">
              {activeFeature.visual.items.map((item) => (
                <div className="marketing-feature-detail-item" key={item.label}>
                  <span className={`marketing-feature-item-icon marketing-feature-item-icon-${item.tone}`}>{item.mark}</span>
                  <span className="marketing-feature-item-copy"><strong>{item.label}</strong><small>{item.meta}</small></span>
                  <b>{item.value}</b>
                </div>
              ))}
            </div>
            <div className="marketing-feature-detail-footer"><span>{activeFeature.visual.footer}</span><strong>{activeFeature.visual.metric}</strong></div>
          </div>
          <span className="marketing-feature-floating-note">{activeFeature.visual.floating}</span>
        </div>
      </div>
    </>
  )
}
