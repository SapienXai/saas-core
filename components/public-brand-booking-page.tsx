"use client"

import Link from "next/link"
import { ArrowRight, CalendarDays, Check, ChevronDown, Clock3, LayoutGrid, List, Search, Users } from "lucide-react"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"

import { PublicBrandMap } from "@/components/public-brand-map"
import { RestaurantCardViewCard, RestaurantListViewItem } from "@/components/restaurant-results-cards"
import { useLanguage } from "@/context/language-context"
import { getPublicMapCoordinates } from "@/lib/public-map"
import type { PublicBrand, PublicBrandBookingRule } from "@/lib/services/public/brand-service"

type AvailabilityStatus = "available" | "nearby" | "unavailable" | "error" | "loading"
type AvailabilityState = {
  status: AvailabilityStatus
  slots: string[]
  requestedTimeAvailable: boolean
}

type Props = { brand: PublicBrand }

const VIEW_MODE_STORAGE_KEY = "reservevia:customer-results-view"

function defaultResultsViewMode(locationCount: number): "card" | "list" {
  return locationCount <= 3 ? "card" : "list"
}

function todayValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

const FALLBACK_BOOKING_RULE: PublicBrandBookingRule = {
  openingTime: "17:00",
  closingTime: "20:45",
  timeSlotDuration: 15,
  advanceBookingDays: 15,
  minAdvanceHours: 0,
  minPartySize: 1,
  maxPartySize: 8,
  allowedDaysOfWeek: [1, 2, 3, 4, 5, 6, 7],
  blockedDates: [],
  reservationStartDate: null,
  reservationEnabled: true,
}

function bookingRulesForLocation(location: PublicBrand["locations"][number]) {
  return location.bookingRules?.length
    ? location.bookingRules
    : [{ ...FALLBACK_BOOKING_RULE, reservationEnabled: location.reservationEnabled }]
}

function parseDateValue(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3])
    ? date
    : null
}

function dateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function timeToMinutes(value: string | null | undefined) {
  if (!value) return null
  const [hour, minute] = value.split(":").map(Number)
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 24 || minute < 0 || minute > 59 || (hour === 24 && minute !== 0)) return null
  return hour * 60 + minute
}

function minutesToTime(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`
}

function ruleSupportsDate(rule: PublicBrandBookingRule, value: string, now: Date) {
  if (!rule.reservationEnabled) return false
  const date = parseDateValue(value)
  if (!date) return false

  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const latestDate = new Date(today)
  latestDate.setDate(today.getDate() + rule.advanceBookingDays - 1)
  const databaseWeekday = date.getDay() === 0 ? 7 : date.getDay()

  return date >= today
    && date <= latestDate
    && (!rule.reservationStartDate || value >= rule.reservationStartDate)
    && rule.allowedDaysOfWeek.includes(databaseWeekday)
    && !rule.blockedDates.includes(value)
}

function ruleSupportsSelection(rule: PublicBrandBookingRule, value: string, time: string, guests: number, now: Date) {
  if (!ruleSupportsDate(rule, value, now) || guests < rule.minPartySize || guests > rule.maxPartySize) return false
  const selectedMinutes = timeToMinutes(time)
  const openingMinutes = timeToMinutes(rule.openingTime)
  const closingMinutes = timeToMinutes(rule.closingTime)
  if (selectedMinutes === null || openingMinutes === null || closingMinutes === null || !Number.isInteger(rule.timeSlotDuration) || rule.timeSlotDuration <= 0) return false
  if (selectedMinutes < openingMinutes || selectedMinutes > closingMinutes || (selectedMinutes - openingMinutes) % rule.timeSlotDuration !== 0) return false

  const date = parseDateValue(value)
  if (!date) return false
  date.setHours(Math.floor(selectedMinutes / 60), selectedMinutes % 60, 0, 0)
  return date.getTime() >= now.getTime() + rule.minAdvanceHours * 60 * 60 * 1000
}

function timeOptionsForDate(rules: PublicBrandBookingRule[], value: string, guests: number, now: Date) {
  const options = new Set<string>()
  for (const rule of rules) {
    if (!ruleSupportsDate(rule, value, now) || guests < rule.minPartySize || guests > rule.maxPartySize) continue
    const openingMinutes = timeToMinutes(rule.openingTime)
    const closingMinutes = timeToMinutes(rule.closingTime)
    if (openingMinutes === null || closingMinutes === null || !Number.isInteger(rule.timeSlotDuration) || rule.timeSlotDuration <= 0) continue
    for (let minutes = openingMinutes; minutes <= closingMinutes && minutes < 24 * 60; minutes += rule.timeSlotDuration) {
      const time = minutesToTime(minutes)
      if (ruleSupportsSelection(rule, value, time, guests, now)) options.add(time)
    }
  }
  return Array.from(options).sort()
}

function dateOptionsForRules(rules: PublicBrandBookingRule[], guests: number, now: Date) {
  const maxDays = Math.max(0, ...rules.map((rule) => rule.advanceBookingDays))
  const options: string[] = []
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  for (let offset = 0; offset < maxDays; offset += 1) {
    const date = new Date(start)
    date.setDate(start.getDate() + offset)
    const value = dateValue(date)
    if (rules.some((rule) => ruleSupportsDate(rule, value, now) && timeOptionsForDate([rule], value, guests, now).length > 0)) options.push(value)
  }
  return options
}

function guestOptionsForRules(rules: PublicBrandBookingRule[]) {
  if (rules.length === 0) return []
  const min = Math.max(1, Math.min(...rules.map((rule) => Math.ceil(rule.minPartySize))))
  const max = Math.min(100, Math.max(...rules.map((rule) => Math.floor(rule.maxPartySize))))
  if (max < min) return []
  return Array.from({ length: max - min + 1 }, (_, index) => min + index)
    .filter((guests) => rules.some((rule) => rule.reservationEnabled && guests >= rule.minPartySize && guests <= rule.maxPartySize))
}

function formatDateOption(value: string, locale: string) {
  const date = parseDateValue(value)
  if (!date) return value
  return new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric" }).format(date)
}

type BookingFieldOption = {
  value: string
  label: string
}

function BookingSelectField({ icon, label, value, options, disabled, onChange }: { icon: ReactNode; label: string; value: string; options: BookingFieldOption[]; disabled: boolean; onChange: (value: string) => void }) {
  const [isOpen, setIsOpen] = useState(false)
  const fieldRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listboxId = useId()
  const selectedOption = options.find((option) => option.value === value)

  useEffect(() => {
    if (!isOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      if (!fieldRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [isOpen])

  const chooseOption = (nextValue: string) => {
    onChange(nextValue)
    setIsOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div ref={fieldRef} className={`public-brand-search-field${isOpen ? " is-open" : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        className="public-brand-search-field-trigger"
        aria-label={label}
        aria-controls={listboxId}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="public-brand-search-field-header">
          <span className="public-brand-search-field-label">{icon}<span>{label}</span></span>
          <ChevronDown aria-hidden="true" />
        </span>
        <span className="public-brand-search-field-value">{selectedOption?.label || value}</span>
      </button>
      {isOpen ? (
        <div id={listboxId} className="public-brand-search-field-options" role="listbox" aria-label={label}>
          {options.map((option) => {
            const selected = option.value === value
            return <button key={option.value} type="button" role="option" aria-selected={selected} className={selected ? "is-selected" : ""} onClick={() => chooseOption(option.value)}><span>{option.label}</span>{selected ? <Check aria-hidden="true" /> : null}</button>
          })}
        </div>
      ) : null}
    </div>
  )
}

function reservationHref(slug: string, date: string, time: string, guests: number, from?: string) {
  const params = new URLSearchParams({ restaurantSlug: slug, date, time, guests: String(guests) })
  if (from) params.set("from", from)
  return `/reserve?${params.toString()}`
}

function hasValidCoordinate(location: PublicBrand["locations"][number]) {
  return getPublicMapCoordinates(location) !== null
}

export function PublicBrandBookingPage({ brand }: Props) {
  const { currentLang, getTranslation } = useLanguage()
  const defaultViewMode = defaultResultsViewMode(brand.locations.length)
  const viewModeStorageKey = `${VIEW_MODE_STORAGE_KEY}:${brand.slug}`
  const [selectedLocation, setSelectedLocation] = useState("all")
  const [date, setDate] = useState(todayValue)
  const [time, setTime] = useState("19:00")
  const [guests, setGuests] = useState("2")
  const [availability, setAvailability] = useState<Record<string, AvailabilityState>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [viewMode, setViewMode] = useState<"card" | "list">(defaultViewMode)
  const [viewModeHydrated, setViewModeHydrated] = useState(false)
  const hydratedViewModeKeyRef = useRef<string | null>(null)
  const [highlightedLocationSlug, setHighlightedLocationSlug] = useState<string | null>(null)

  const selectedGuests = Math.max(1, Math.min(100, Number.parseInt(guests, 10) || 2))
  const [submittedSearch, setSubmittedSearch] = useState(() => ({ date, time, guests: selectedGuests }))
  const now = useMemo(() => new Date(), [])
  const selectedScopeLocations = useMemo(
    () => selectedLocation === "all" ? brand.locations : brand.locations.filter((location) => location.slug === selectedLocation),
    [brand.locations, selectedLocation],
  )
  const selectedRules = useMemo(() => selectedScopeLocations.flatMap(bookingRulesForLocation), [selectedScopeLocations])
  const guestOptions = useMemo(() => guestOptionsForRules(selectedRules), [selectedRules])
  const normalizedGuests = guestOptions.includes(selectedGuests) ? selectedGuests : guestOptions[0] ?? selectedGuests
  const dateOptions = useMemo(() => dateOptionsForRules(selectedRules, normalizedGuests, now), [now, normalizedGuests, selectedRules])
  const normalizedDate = dateOptions.includes(date) ? date : dateOptions[0] ?? date
  const timeOptions = useMemo(() => timeOptionsForDate(selectedRules, normalizedDate, normalizedGuests, now), [now, normalizedDate, normalizedGuests, selectedRules])
  const normalizedTime = timeOptions.includes(time) ? time : timeOptions[0] ?? time
  const visibleLocations = useMemo(
    () => selectedScopeLocations.filter((location) => bookingRulesForLocation(location).some((rule) => ruleSupportsSelection(rule, normalizedDate, normalizedTime, normalizedGuests, now))),
    [now, normalizedDate, normalizedGuests, normalizedTime, selectedScopeLocations],
  )
  const mappedLocationCount = brand.locations.filter(hasValidCoordinate).length
  const hasMap = brand.locations.length >= 2 && mappedLocationCount > 0
  const brandReturnHref = `/brand/${encodeURIComponent(brand.slug)}`

  const selectLocation = (locationSlug: string) => {
    setHighlightedLocationSlug(null)
    setSelectedLocation(locationSlug)
  }

  useEffect(() => {
    hydratedViewModeKeyRef.current = null
    setViewMode(defaultViewMode)
    setViewModeHydrated(false)
    try {
      const stored = window.localStorage.getItem(viewModeStorageKey)
      if (stored === "card" || stored === "list") setViewMode(stored)
    } catch {
      // Local storage can be unavailable in privacy-restricted browsers.
    } finally {
      hydratedViewModeKeyRef.current = viewModeStorageKey
      setViewModeHydrated(true)
    }
  }, [defaultViewMode, viewModeStorageKey])

  useEffect(() => {
    if (!viewModeHydrated || hydratedViewModeKeyRef.current !== viewModeStorageKey) return
    try {
      window.localStorage.setItem(viewModeStorageKey, viewMode)
    } catch {
      // Local storage can be unavailable in privacy-restricted browsers.
    }
  }, [viewMode, viewModeHydrated, viewModeStorageKey])

  useEffect(() => {
    const nextDate = normalizedDate
    const nextTime = normalizedTime
    const nextGuests = String(normalizedGuests)
    const needsNormalization = date !== nextDate || time !== nextTime || guests !== nextGuests
    if (date !== nextDate) setDate(nextDate)
    if (time !== nextTime) setTime(nextTime)
    if (guests !== nextGuests) setGuests(nextGuests)
    if (needsNormalization) setSubmittedSearch({ date: nextDate, time: nextTime, guests: normalizedGuests })
  }, [date, guests, normalizedDate, normalizedGuests, normalizedTime, time])

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      setLoading(true)
      setError(false)
      setAvailability({})
      try {
        const params = new URLSearchParams({ date: submittedSearch.date, guests: String(submittedSearch.guests), time: submittedSearch.time })
        const response = await fetch(`/api/public/brands/${encodeURIComponent(brand.slug)}/availability?${params.toString()}`, { signal: controller.signal, cache: "no-store" })
        if (!response.ok) throw new Error("availability-request-failed")
        const payload = await response.json() as { locations?: Array<{ slug: string; status: AvailabilityStatus; slots: string[]; requestedTimeAvailable: boolean }> }
        const next = Object.fromEntries((payload.locations || []).map((location) => [location.slug, location]))
        setAvailability(next)
      } catch (requestError) {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return
        setError(true)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [brand.slug, submittedSearch])

  return (
    <main className="public-brand-page">
      <div className="public-brand-shell">
        {hasMap ? <section className="public-brand-map-hero" aria-label={getTranslation("public.brand.mapLabel")}>
          <PublicBrandMap
            locations={brand.locations}
            logoUrl={brand.logoUrl}
            brandName={brand.name}
            focusLocationSlug={selectedLocation}
            highlightLocationSlug={highlightedLocationSlug}
            onLocationSelect={selectLocation}
          />
        </section> : null}

        <section id="brand-search" className={`public-brand-search${hasMap ? " public-brand-search--overlap" : ""}`} aria-label={getTranslation("public.brand.searchLabel")}>
          <div className="public-brand-location-filter" role="group" aria-label={getTranslation("public.brand.locationFilter")}>
            <button type="button" className={selectedLocation === "all" ? "is-selected" : ""} onClick={() => selectLocation("all")}>{getTranslation("public.brand.allLocations")}</button>
            {brand.locations.map((location) => <button key={location.slug} type="button" className={selectedLocation === location.slug ? "is-selected" : ""} onClick={() => selectLocation(location.slug)}>{location.name}</button>)}
          </div>
          <div className="public-brand-search-fields">
            <BookingSelectField icon={<CalendarDays aria-hidden="true" />} label={getTranslation("public.brand.date")} value={normalizedDate} options={dateOptions.map((value) => ({ value, label: formatDateOption(value, currentLang) }))} disabled={!dateOptions.length} onChange={setDate} />
            <BookingSelectField icon={<Clock3 aria-hidden="true" />} label={getTranslation("public.brand.time")} value={normalizedTime} options={timeOptions.map((value) => ({ value, label: value }))} disabled={!timeOptions.length} onChange={setTime} />
            <BookingSelectField icon={<Users aria-hidden="true" />} label={getTranslation("public.brand.guests")} value={String(normalizedGuests)} options={guestOptions.map((value) => ({ value: String(value), label: String(value) }))} disabled={!guestOptions.length} onChange={setGuests} />
            <button type="button" className="public-brand-search-button" disabled={!visibleLocations.length || !dateOptions.length || !timeOptions.length || !guestOptions.length} onClick={() => setSubmittedSearch({ date: normalizedDate, time: normalizedTime, guests: normalizedGuests })}><Search aria-hidden="true" />{getTranslation("public.brand.findTable")}</button>
          </div>
        </section>

        <section id="brand-locations" className="public-brand-locations" aria-label={getTranslation("public.brand.locationsTitle")}>
          <div className="public-brand-results-toolbar">
            <div className="public-brand-view-toggle" role="group" aria-label={getTranslation("public.brand.viewMode")}>
              <button type="button" className={viewMode === "card" ? "is-selected" : ""} aria-pressed={viewMode === "card"} onClick={() => setViewMode("card")}><LayoutGrid aria-hidden="true" />{getTranslation("public.brand.cardView")}</button>
              <button type="button" className={viewMode === "list" ? "is-selected" : ""} aria-pressed={viewMode === "list"} onClick={() => setViewMode("list")}><List aria-hidden="true" />{getTranslation("public.brand.listView")}</button>
            </div>
          </div>
          {visibleLocations.length ? <div className={`public-brand-result-grid${viewMode === "list" ? " is-list" : ""}`}>
            {visibleLocations.map((location) => {
              const props = {
                location,
                availability: availability[location.slug],
                loading,
                error,
                submittedSearch,
                brandReturnHref,
                onLocationFocus: () => setHighlightedLocationSlug(location.slug),
                onLocationBlur: () => setHighlightedLocationSlug(null),
              }
              return viewMode === "list"
                ? <RestaurantListViewItem key={location.slug} {...props} />
                : <RestaurantCardViewCard key={location.slug} {...props} />
            })}
          </div> : <p className="public-brand-no-matching-locations">{getTranslation("public.brand.noMatchingLocations")}</p>}
        </section>

        <footer className="public-brand-footer">
          <div className="public-brand-footer-inner">
            <div className="public-brand-footer-main">
              <div className="public-brand-footer-brand">
                <div className="public-brand-footer-brand-copy">
                  <p className="public-brand-footer-eyebrow">{getTranslation("public.brand.footerEyebrow")}</p>
                  <h2>{getTranslation("public.brand.footerTitle")}</h2>
                </div>
                <Link className="public-brand-footer-cta" href="#brand-search">{getTranslation("public.brand.findTable")}<ArrowRight aria-hidden="true" /></Link>
              </div>

              <div className="public-brand-footer-columns">
                <div>
                  <p className="public-brand-footer-label">{getTranslation("public.brand.footerLocations")}</p>
                  <nav className="public-brand-footer-links" aria-label={getTranslation("public.brand.footerLocations")}>
                    {brand.locations.map((location) => <Link key={location.slug} href={reservationHref(location.slug, submittedSearch.date, submittedSearch.time, submittedSearch.guests, brandReturnHref)}>{location.name}</Link>)}
                  </nav>
                </div>
                <div>
                  <p className="public-brand-footer-label">{getTranslation("public.brand.footerReservevia")}</p>
                  <nav className="public-brand-footer-links" aria-label={getTranslation("public.brand.footerReservevia")}>
                    <Link href="/terms">{getTranslation("public.brand.footerTerms")}</Link>
                    <Link href="/privacy">{getTranslation("public.brand.footerPrivacy")}</Link>
                  </nav>
                </div>
              </div>
            </div>

            <div className="public-brand-footer-bottom">
              <span>{getTranslation("public.brand.footerCopyright", { year: new Date().getFullYear(), brand: brand.name })}</span>
              <span>{getTranslation("public.brand.footerPoweredBy")} <Link href="/">Reservevia</Link></span>
            </div>
          </div>
        </footer>
      </div>
    </main>
  )
}
