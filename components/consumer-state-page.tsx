"use client"

import Link from "next/link"
import {
  AlertCircle,
  ArrowRight,
  CalendarX2,
  CheckCircle2,
  Compass,
  Home,
  SearchX,
  Store,
  Wrench,
} from "lucide-react"

import { useLanguage } from "@/context/language-context"

export type ConsumerStateVariant =
  | "error"
  | "unavailable"
  | "maintenance"
  | "empty"
  | "noAvailability"
  | "closed"
  | "expired"

interface ConsumerStatePageProps {
  variant: ConsumerStateVariant
  compact?: boolean
  title?: string
  description?: string
  primaryHref?: string
  primaryLabel?: string
  secondaryHref?: string
  secondaryLabel?: string
  onRetry?: () => void
}

const icons = {
  error: AlertCircle,
  unavailable: Store,
  maintenance: Wrench,
  empty: SearchX,
  noAvailability: CalendarX2,
  closed: Store,
  expired: Compass,
}

export function ConsumerStatePage({
  variant,
  compact = false,
  title,
  description,
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
  onRetry,
}: ConsumerStatePageProps) {
  const { getTranslation } = useLanguage()
  const Icon = icons[variant]

  const copy = {
    error: {
      eyebrow: getTranslation("public.errorTitle"),
      title: getTranslation("public.errorHeading"),
      description: getTranslation("public.errorDescription"),
      primaryLabel: getTranslation("public.tryAgain"),
      primaryHref: "/",
      secondaryLabel: getTranslation("public.returnHome"),
      secondaryHref: "/",
    },
    unavailable: {
      eyebrow: getTranslation("public.unavailableEyebrow"),
      title: getTranslation("public.unavailableHeading"),
      description: getTranslation("public.unavailableDescription"),
      primaryLabel: getTranslation("public.browseRestaurants"),
      primaryHref: "/restaurants",
      secondaryLabel: getTranslation("public.returnHome"),
      secondaryHref: "/",
    },
    maintenance: {
      eyebrow: getTranslation("public.maintenanceEyebrow"),
      title: getTranslation("public.maintenanceHeading"),
      description: getTranslation("public.maintenanceDescription"),
      primaryLabel: getTranslation("public.returnHome"),
      primaryHref: "/",
      secondaryLabel: getTranslation("public.browseRestaurants"),
      secondaryHref: "/restaurants",
    },
    empty: {
      eyebrow: getTranslation("public.emptyEyebrow"),
      title: getTranslation("public.emptyHeading"),
      description: getTranslation("public.emptyDescription"),
      primaryLabel: getTranslation("public.returnHome"),
      primaryHref: "/",
      secondaryLabel: getTranslation("marketing.startForFree"),
      secondaryHref: "/signup",
    },
    noAvailability: {
      eyebrow: getTranslation("reserve.noAvailabilityEyebrow"),
      title: getTranslation("reserve.noAvailabilityHeading"),
      description: getTranslation("reserve.noAvailabilityDescription"),
      primaryLabel: getTranslation("public.browseRestaurants"),
      primaryHref: "/restaurants",
      secondaryLabel: getTranslation("public.returnHome"),
      secondaryHref: "/",
    },
    closed: {
      eyebrow: getTranslation("reserve.closedEyebrow"),
      title: getTranslation("reserve.closedHeading"),
      description: getTranslation("reserve.closedDescription"),
      primaryLabel: getTranslation("public.browseRestaurants"),
      primaryHref: "/restaurants",
      secondaryLabel: getTranslation("public.returnHome"),
      secondaryHref: "/",
    },
    expired: {
      eyebrow: getTranslation("reserve.expiredEyebrow"),
      title: getTranslation("reserve.expiredHeading"),
      description: getTranslation("reserve.expiredDescription"),
      primaryLabel: getTranslation("public.returnHome"),
      primaryHref: "/",
      secondaryLabel: getTranslation("public.browseRestaurants"),
      secondaryHref: "/restaurants",
    },
  }[variant]

  const resolvedPrimaryLabel = primaryLabel || copy.primaryLabel
  const resolvedPrimaryHref = primaryHref || copy.primaryHref
  const resolvedSecondaryLabel = secondaryLabel || copy.secondaryLabel
  const resolvedSecondaryHref = secondaryHref || copy.secondaryHref

  return (
    <section className={`consumer-state-page consumer-state-${variant}${compact ? " consumer-state-page-compact" : ""}`}>
      <div className="consumer-state-glow consumer-state-glow-one" aria-hidden="true" />
      <div className="consumer-state-glow consumer-state-glow-two" aria-hidden="true" />
      <div className="consumer-state-shell" role="status">
        <div className="consumer-state-mark" aria-hidden="true">
          <span className="consumer-state-mark-ring" />
          <span className="consumer-state-mark-orbit" />
          <span className="consumer-state-mark-icon"><Icon /></span>
        </div>
        <p className="consumer-state-eyebrow">{copy.eyebrow}</p>
        <h1>{title || copy.title}</h1>
        <p className="consumer-state-description">{description || copy.description}</p>
        <div className="consumer-state-actions">
          {onRetry ? (
            <button type="button" className="consumer-state-button consumer-state-button-primary" onClick={onRetry}>
              {resolvedPrimaryLabel}
              <ArrowRight aria-hidden="true" />
            </button>
          ) : (
            <Link href={resolvedPrimaryHref} className="consumer-state-button consumer-state-button-primary">
              {resolvedPrimaryLabel}
              {variant === "error" ? <CheckCircle2 aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
            </Link>
          )}
          {resolvedSecondaryHref && resolvedSecondaryLabel && (
            <Link href={resolvedSecondaryHref} className="consumer-state-button consumer-state-button-secondary">
              {variant === "error" ? <Home aria-hidden="true" /> : null}
              {resolvedSecondaryLabel}
            </Link>
          )}
        </div>
      </div>
    </section>
  )
}
