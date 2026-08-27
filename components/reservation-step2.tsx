"use client"

import { useLanguage } from "@/context/language-context"
import { formatCustomerReservationTime } from "@/lib/reservation-display"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { PointerEvent as ReactPointerEvent } from "react"
import { Calendar, ChevronDown, Users, X } from "lucide-react"
import type { PrivacyNoticeContent } from "@/lib/privacy-notice"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_GUEST_AGE = 1
const MAX_GUEST_AGE = 65
const DEFAULT_MIN_GUEST_AGE = 25
const DEFAULT_MAX_GUEST_AGE = 30
const GUEST_AGE_OPTIONS = Array.from(
  { length: MAX_GUEST_AGE - MIN_GUEST_AGE + 1 },
  (_, index) => index + MIN_GUEST_AGE
)
const formatGuestAge = (age: number) => age === MAX_GUEST_AGE ? `${MAX_GUEST_AGE}+` : age.toString()

function useDrawerSwipe(onClose: () => void) {
  const startYRef = useRef<number | null>(null)
  const [dragOffset, setDragOffset] = useState(0)

  const reset = useCallback(() => {
    startYRef.current = null
    setDragOffset(0)
  }, [])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (window.innerWidth >= 640 || (event.pointerType === "mouse" && event.button !== 0)) return
    startYRef.current = event.clientY
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [])

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (startYRef.current === null) return
    const delta = event.clientY - startYRef.current
    setDragOffset(Math.max(0, delta))
    if (delta > 0) event.preventDefault()
  }, [])

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (startYRef.current === null) return
    const delta = event.clientY - startYRef.current
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    reset()
    if (delta > 120) onClose()
  }, [onClose, reset])

  return {
    style: dragOffset > 0 ? { transform: `translate(-50%, ${dragOffset}px)` } : undefined,
    isDragging: dragOffset > 0,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: reset,
    reset,
  }
}

function TermsDrawerContent({ contactEmail }: { contactEmail: string }) {
  const { getTranslation } = useLanguage()
  return (
    <div className="space-y-6 text-sm leading-6 text-slate-600">
      <section>
        <h3 className="font-semibold text-slate-900">{getTranslation("reserve.step2.terms.acceptanceTitle")}</h3>
        <p className="mt-2">{getTranslation("reserve.step2.terms.acceptanceBody")}</p>
      </section>
      <section>
        <h3 className="font-semibold text-slate-900">{getTranslation("reserve.step2.terms.reservationTitle")}</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>{getTranslation("reserve.step2.terms.reservationAvailability")}</li>
          <li>{getTranslation("reserve.step2.terms.reservationEdit")}</li>
          <li>{getTranslation("reserve.step2.terms.reservationCancel")}</li>
          <li>{getTranslation("reserve.step2.terms.reservationLate")}</li>
          <li>{getTranslation("reserve.step2.terms.reservationNoShows")}</li>
        </ul>
      </section>
      <section>
        <h3 className="font-semibold text-slate-900">{getTranslation("reserve.step2.terms.cancellationTitle")}</h3>
        <p className="mt-2">{getTranslation("reserve.step2.terms.cancellationBody")}</p>
      </section>
      <section>
        <h3 className="font-semibold text-slate-900">{getTranslation("reserve.step2.terms.restaurantTitle")}</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>{getTranslation("reserve.step2.terms.dressCode")}</li>
          <li>{getTranslation("reserve.step2.terms.dietary")}</li>
          <li>{getTranslation("reserve.step2.terms.children")}</li>
          <li>{getTranslation("reserve.step2.terms.smoking")}</li>
        </ul>
      </section>
      <section>
        <h3 className="font-semibold text-slate-900">{getTranslation("reserve.step2.terms.liabilityTitle")}</h3>
        <p className="mt-2">{getTranslation("reserve.step2.terms.liabilityBody")}</p>
      </section>
      <section>
        <h3 className="font-semibold text-slate-900">{getTranslation("reserve.step2.terms.dataTitle")}</h3>
        <p className="mt-2">{getTranslation("reserve.step2.terms.dataBody")}</p>
      </section>
      <section>
        <h3 className="font-semibold text-slate-900">{getTranslation("reserve.step2.terms.changesTitle")}</h3>
        <p className="mt-2">{getTranslation("reserve.step2.terms.changesBody")}</p>
      </section>
      <section>
        <h3 className="font-semibold text-slate-900">{getTranslation("reserve.step2.terms.contactTitle")}</h3>
        <p className="mt-2">
          {getTranslation("reserve.step2.terms.contactBody")}
          <br />{getTranslation("reserve.step2.terms.emailLabel")}: {contactEmail}
        </p>
      </section>
    </div>
  )
}

interface ReservationArea {
  id: string
  restaurant_id: string
  name: string
  description: string | null
  is_active: boolean
  display_order: number
  opening_time: string | null
  closing_time: string | null
  time_slot_duration: number | null
  max_party_size: number | null
  min_party_size: number | null
  advance_booking_days: number | null
  min_advance_hours: number | null
  allowed_days_of_week: number[] | null
  blocked_dates: string[] | null
  special_hours: any | null
  max_concurrent_reservations: number | null
  created_at: string
  updated_at: string
}

interface ReservationStep2Props {
  restaurantName: string
  partySize: string
  selectedDate: Date
  selectedTime: string
  customerName: string
  setCustomerName: (name: string) => void
  customerPhone: string
  setCustomerPhone: (phone: string) => void
  customerEmail: string
  setCustomerEmail: (email: string) => void
  specialRequests: string
  setSpecialRequests: (requests: string) => void
  minGuestAge: number | null
  setMinGuestAge: (age: number | null) => void
  maxGuestAge: number | null
  setMaxGuestAge: (age: number | null) => void
  reservationType: string
  setReservationType: (type: string) => void
  mealOnlyReservations: boolean
  getDisplayDate: (date: Date, lang: string, includeDayName?: boolean) => string
  attemptedSubmit?: boolean
  selectedAreaId?: string | null
  areas?: ReservationArea[]
  privacyNotice?: PrivacyNoticeContent | null
  dialogContainer?: HTMLElement | null
}

export function ReservationStep2({
  restaurantName,
  partySize,
  selectedDate,
  selectedTime,
  customerName,
  setCustomerName,
  customerPhone,
  setCustomerPhone,
  customerEmail,
  setCustomerEmail,
  specialRequests,
  setSpecialRequests,
  minGuestAge,
  setMinGuestAge,
  maxGuestAge,
  setMaxGuestAge,
  reservationType,
  setReservationType,
  mealOnlyReservations,
  getDisplayDate,
  attemptedSubmit = false,
  selectedAreaId,
  areas,
  privacyNotice,
  dialogContainer,
}: ReservationStep2Props) {
  const { getTranslation, currentLang } = useLanguage()
  const [showContactFields, setShowContactFields] = useState(false)
  const [showAgeRangePicker, setShowAgeRangePicker] = useState(false)
  const [showTerms, setShowTerms] = useState(false)
  const [showPrivacyNotice, setShowPrivacyNotice] = useState(false)
  const [draftMinGuestAge, setDraftMinGuestAge] = useState(minGuestAge ?? DEFAULT_MIN_GUEST_AGE)
  const [draftMaxGuestAge, setDraftMaxGuestAge] = useState(maxGuestAge ?? DEFAULT_MAX_GUEST_AGE)
  const [rulesAcknowledged, setRulesAcknowledged] = useState(true)
  const contactSectionRef = useRef<HTMLDivElement | null>(null)
  const closePrivacyNotice = useCallback(() => setShowPrivacyNotice(false), [])
  const closeTerms = useCallback(() => setShowTerms(false), [])
  const privacySwipe = useDrawerSwipe(closePrivacyNotice)
  const termsSwipe = useDrawerSwipe(closeTerms)
  const [touched, setTouched] = useState<{ name: boolean; email: boolean; phone: boolean; ageRange: boolean }>({
    name: false,
    email: false,
    phone: false,
    ageRange: false,
  })

  // Check if selected area is Terrace or Deck (dining only areas)
  // Exception: Felix Marina's Terrace area accepts drinks reservations
  const selectedArea = areas?.find(area => area.id === selectedAreaId)
  const isFelixMarinaTerraceArea = selectedArea && 
    restaurantName.toLowerCase().includes('felix') && 
    restaurantName.toLowerCase().includes('marina') && 
    selectedArea.name.toLowerCase().includes('terrace')
  const isFelixMarina = restaurantName.toLowerCase().includes('felix') && restaurantName.toLowerCase().includes('marina')
  const isDiningOnlyArea = selectedArea && 
    (selectedArea.name.toLowerCase().includes('terrace') || selectedArea.name.toLowerCase().includes('deck')) &&
    !isFelixMarinaTerraceArea
  const effectiveMealOnlyReservations = mealOnlyReservations || isDiningOnlyArea

  // Force meal reservation type for dining-only areas
  useEffect(() => {
    if (isDiningOnlyArea && reservationType !== 'meal') {
      setReservationType('meal')
    }
  }, [isDiningOnlyArea, reservationType, setReservationType])

  // Basic validators
  const errors = useMemo(() => {
    const errs: { name?: string; email?: string; phone?: string; ageRange?: string } = {}
    if (!customerName || customerName.trim().length === 0) {
      errs.name = getTranslation("reserve.step2.errors.nameRequired")
    }
    if (!customerEmail || customerEmail.trim().length === 0) {
      errs.email = getTranslation("reserve.step2.errors.emailRequired")
    } else if (!EMAIL_REGEX.test(customerEmail)) {
      errs.email = getTranslation("reserve.step2.errors.emailInvalid")
    }
    if (!customerPhone || customerPhone.trim().length === 0) {
      errs.phone = getTranslation("reserve.step2.errors.phoneRequired")
    }
    if (minGuestAge === null || maxGuestAge === null) {
      errs.ageRange = getTranslation("reserve.step2.errors.guestAgeRangeRequired")
    }
    return errs
  }, [customerName, customerEmail, customerPhone, minGuestAge, maxGuestAge, getTranslation])

  // Only auto-open the contact section when a submit attempt is made and there are errors
  useEffect(() => {
    if (attemptedSubmit && (errors.name || errors.email || errors.phone || errors.ageRange)) {
      setShowContactFields(true)
      // Mark all as touched to show errors inline
      setTouched({ name: true, email: true, phone: true, ageRange: true })

      window.requestAnimationFrame(() => {
        contactSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      })
    }
  }, [attemptedSubmit, errors.name, errors.email, errors.phone, errors.ageRange])

  const getTimezone = () => {
    if (!(selectedDate instanceof Date) || isNaN(selectedDate.getTime())) {
      return getTranslation("reserve.messages.invalidTimezone")
    }
    const offset = -selectedDate.getTimezoneOffset() / 60
    if (!isNaN(offset)) {
      return `(GMT${offset >= 0 ? "+" : ""}${offset.toString().padStart(2, "0")}:00)`
    } else {
      return getTranslation("reserve.messages.invalidTimezone")
    }
  }

  const toggleContactFields = () => {
    setShowContactFields(!showContactFields)
  }

  const openAgeRangePicker = () => {
    setDraftMinGuestAge(minGuestAge ?? DEFAULT_MIN_GUEST_AGE)
    setDraftMaxGuestAge(maxGuestAge ?? DEFAULT_MAX_GUEST_AGE)
    setShowAgeRangePicker(true)
  }

  const cancelAgeRangePicker = () => {
    setDraftMinGuestAge(minGuestAge ?? DEFAULT_MIN_GUEST_AGE)
    setDraftMaxGuestAge(maxGuestAge ?? DEFAULT_MAX_GUEST_AGE)
    setShowAgeRangePicker(false)
  }

  const confirmAgeRangePicker = () => {
    setMinGuestAge(draftMinGuestAge)
    setMaxGuestAge(draftMaxGuestAge)
    setTouched((prev) => ({ ...prev, ageRange: true }))
    setShowAgeRangePicker(false)
  }

  const updateDraftMinGuestAge = (age: number) => {
    const nextAge = Math.min(MAX_GUEST_AGE, Math.max(MIN_GUEST_AGE, age))
    setDraftMinGuestAge(nextAge)
    if (draftMaxGuestAge < nextAge) {
      setDraftMaxGuestAge(nextAge)
    }
  }

  const updateDraftMaxGuestAge = (age: number) => {
    setDraftMaxGuestAge(Math.min(MAX_GUEST_AGE, Math.max(MIN_GUEST_AGE, draftMinGuestAge, age)))
  }

  const renderReservationTypeMealLabel = () => {
    const label = getTranslation("reserve.step2.reservationTypeMeal")
    const match = label.match(/^(.*?)(\s*\(.*\))$/)

    if (!match) {
      return <span>{label}</span>
    }

    return (
      <span className="reservation-type-label">
        <span>{match[1].trim()}</span>
        <span className="reservation-type-label-sub">{match[2].trim()}</span>
      </span>
    )
  }

  return (
    <div id="step2">
      <div className="summary-section">
        <div className="summary-item">
          <Users className="w-6 h-6 text-muted-foreground" />
          <div className="summary-item-details">
            <div className="main-text" id="summaryParty">
              {getTranslation("reserve.step2.summaryPartyOf", {
                count: partySize === "8" ? "8+" : partySize,
              })}
            </div>
            <div className="sub-text" id="summaryRestaurantName">
              {restaurantName}
            </div>
          </div>
        </div>
        <div className="summary-item">
          <Calendar className="w-6 h-6 text-muted-foreground" />
          <div className="summary-item-details">
            <div className="main-text" id="summaryDateTime">
              {getDisplayDate(selectedDate, currentLang, true)}, {formatCustomerReservationTime(selectedTime)}
            </div>
            <div className="sub-text" id="summaryTimezone">
              {getTimezone()}
            </div>
          </div>
        </div>
      </div>

      <div className="contact-info-section" ref={contactSectionRef}>
        <h2 className="section-title">{getTranslation("reserve.step2.contactInfoTitle")}</h2>
        {!showContactFields ? (
          <button className="add-info-button" id="addContactInfoBtn" onClick={toggleContactFields}>
            <span>{getTranslation("reserve.step2.addContactInfoButton")}</span>
            <i className="bi bi-chevron-right"></i>
          </button>
        ) : (
          <div className="contact-fields mt-3" id="contactFields">
            <div className="mb-2">
              <label htmlFor="customerName" className="form-label">
                {getTranslation("reserve.step2.fullNameLabel")}
              </label>
              <input
                type="text"
                className={`form-control ${touched.name && errors.name ? 'border-red-500' : ''}`}
                id="customerName"
                placeholder={getTranslation("reserve.step2.requiredPlaceholder")}
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                onBlur={() => setTouched((prev) => ({ ...prev, name: true }))}
              />
              {(touched.name || attemptedSubmit) && errors.name && (
                <p className="text-red-600 text-xs mt-1">{errors.name}</p>
              )}
            </div>
            <div className="mb-2">
              <label htmlFor="customerPhone" className="form-label">
                {getTranslation("reserve.step2.phoneLabel")}
              </label>
              <input
                type="tel"
                className={`form-control ${touched.phone && errors.phone ? 'border-red-500' : ''}`}
                id="customerPhone"
                placeholder={getTranslation("reserve.step2.requiredPlaceholder")}
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                onBlur={() => setTouched((prev) => ({ ...prev, phone: true }))}
              />
              {(touched.phone || attemptedSubmit) && errors.phone && (
                <p className="text-red-600 text-xs mt-1">{errors.phone}</p>
              )}
            </div>
            <div className="mb-2">
              <label htmlFor="customerEmail" className="form-label">
                {getTranslation("reserve.step2.emailLabel")} *
              </label>
              <input
                type="email"
                className={`form-control ${touched.email && errors.email ? 'border-red-500' : ''}`}
                id="customerEmail"
                placeholder={getTranslation("reserve.step2.requiredPlaceholder")}
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                required
                onBlur={() => setTouched((prev) => ({ ...prev, email: true }))}
              />
              {(touched.email || attemptedSubmit) && errors.email && (
                <p className="text-red-600 text-xs mt-1">{errors.email}</p>
              )}
            </div>
            <div className="mb-2">
              <label htmlFor="guestAgeRange" className="form-label">
                {getTranslation("reserve.step2.guestAgeRangeTitle")} *
              </label>
              <button
                id="guestAgeRange"
                type="button"
                className={`age-range-field ${minGuestAge === null || maxGuestAge === null ? "placeholder" : ""} ${showAgeRangePicker ? "open" : ""} ${touched.ageRange && errors.ageRange ? "border-red-500" : ""}`}
                onClick={openAgeRangePicker}
                aria-expanded={showAgeRangePicker}
                aria-controls="guestAgeRangeSheet"
                aria-describedby={(touched.ageRange || attemptedSubmit) && errors.ageRange ? "guestAgeRangeError" : undefined}
              >
                <span>
                  {minGuestAge !== null && maxGuestAge !== null
                    ? `${formatGuestAge(minGuestAge)} - ${formatGuestAge(maxGuestAge)}`
                    : getTranslation("reserve.step2.requiredPlaceholder")}
                </span>
                <i className="bi bi-chevron-down"></i>
              </button>
              {(touched.ageRange || attemptedSubmit) && errors.ageRange && (
                <p id="guestAgeRangeError" className="text-red-600 text-xs mt-1">{errors.ageRange}</p>
              )}
            </div>
          </div>
        )}
      </div>

      {showAgeRangePicker && (
        <div className="age-picker-overlay" role="dialog" aria-modal="true" aria-labelledby="guestAgeRangeTitle">
          <button
            type="button"
            className="age-picker-backdrop"
            aria-label={getTranslation("reserve.step2.guestAgeCancel")}
            onClick={cancelAgeRangePicker}
          />
          <div className="age-picker-sheet" id="guestAgeRangeSheet">
            <div className="age-picker-handle" aria-hidden="true" />
            <div className="age-picker-toolbar">
              <h3 id="guestAgeRangeTitle">{getTranslation("reserve.step2.guestAgeRangeTitle")}</h3>
            </div>
            <p className="age-picker-description">{getTranslation("reserve.step2.guestAgeRangeDescription")}</p>
            <div className="age-picker-fields">
              <div className="age-select-field">
                <label htmlFor="minimumGuestAge">{getTranslation("reserve.step2.guestAgeMinLabel")}</label>
                <div className="age-select-control">
                  <select
                    id="minimumGuestAge"
                    value={draftMinGuestAge}
                    onChange={(event) => updateDraftMinGuestAge(Number(event.target.value))}
                  >
                    {GUEST_AGE_OPTIONS.map((age) => <option key={age} value={age}>{formatGuestAge(age)}</option>)}
                  </select>
                  <ChevronDown aria-hidden="true" />
                </div>
              </div>
              <div className="age-select-field">
                <label htmlFor="maximumGuestAge">{getTranslation("reserve.step2.guestAgeMaxLabel")}</label>
                <div className="age-select-control">
                  <select
                    id="maximumGuestAge"
                    value={draftMaxGuestAge}
                    onChange={(event) => updateDraftMaxGuestAge(Number(event.target.value))}
                  >
                    {GUEST_AGE_OPTIONS.map((age) => (
                      <option key={age} value={age} disabled={age < draftMinGuestAge}>{formatGuestAge(age)}</option>
                    ))}
                  </select>
                  <ChevronDown aria-hidden="true" />
                </div>
              </div>
            </div>
            <div className="age-picker-actions">
              <button type="button" className="age-picker-bottom-action secondary" onClick={cancelAgeRangePicker}>
                {getTranslation("reserve.step2.guestAgeCancel")}
              </button>
              <button type="button" className="age-picker-bottom-action primary" onClick={confirmAgeRangePicker}>
                {getTranslation("reserve.step2.guestAgeSet")}
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="reservation-type-section">
        <div className="booking-panel-header compact">
          <p>{getTranslation("reserve.step2.reservationTypeTitle")}</p>
          <h2>{getTranslation("reserve.step2.reservationTypeDescription")}</h2>
        </div>
        <div className="reservation-type-segment">
          <label className={`reservation-type-option ${reservationType === "meal" ? "selected" : ""}`}>
            <input
              type="radio"
              name="reservationType"
              value="meal"
              checked={reservationType === "meal"}
              onChange={(e) => setReservationType(e.target.value)}
            />
            {renderReservationTypeMealLabel()}
          </label>
          {!effectiveMealOnlyReservations && (
            <label className={`reservation-type-option ${reservationType === "drinks" ? "selected" : ""}`}>
              <input
                type="radio"
                name="reservationType"
                value="drinks"
                checked={reservationType === "drinks"}
                onChange={(e) => setReservationType(e.target.value)}
              />
              <span>{getTranslation("reserve.step2.reservationTypeDrinks")}</span>
            </label>
          )}
        </div>

        {isFelixMarina && reservationType === 'meal' && (
          <p className="reservation-notice">{getTranslation('reserve.step2.marinaDiningNotice')}</p>
        )}

        {effectiveMealOnlyReservations && (
          <p className="reservation-notice">
            {isDiningOnlyArea ? getTranslation("reserve.step2.areaOnlyDiningNotice") : getTranslation("reserve.step2.mealOnlyNotice")}
          </p>
        )}
      </section>

      <div className="special-request-section">
        <h2 className="special-request-title">{getTranslation("reserve.step2.specialRequestTitle")}</h2>
        <textarea
          id="specialRequests"
          className="special-request-input"
          placeholder={getTranslation("reserve.step2.specialRequestPlaceholder")}
          value={specialRequests}
          onChange={(e) => setSpecialRequests(e.target.value)}
        ></textarea>
      </div>

      <div className="rules-restrictions-section mt-4">
        <h3 className="section-title text-sm font-semibold mb-3">{getTranslation("reserve.step2.rulesTitle")}</h3>
        <div className="rules-list">
          <div className="rule-item">
            <span className="rule-bullet text-red-500" aria-hidden="true">•</span>
            <span className="text-sm text-gray-600">{getTranslation("reserve.step2.ruleCancel")}</span>
          </div>
          <div className="rule-item">
            <span className="rule-bullet text-blue-500" aria-hidden="true">•</span>
            <span className="text-sm text-gray-600">{getTranslation("reserve.step2.ruleEditWindow")}</span>
          </div>
        </div>

        <div className="terms-notice mt-4 p-3 bg-gray-50 rounded-md border">
          <label
            htmlFor="rulesAcknowledgement"
            className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs leading-5 text-slate-600 transition-colors hover:border-slate-300"
          >
            <input
              id="rulesAcknowledgement"
              type="checkbox"
              checked={rulesAcknowledged}
              onChange={(event) => setRulesAcknowledged(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-slate-950"
            />
            <span>
              <span className="font-medium text-slate-800">{getTranslation("reserve.step2.rulesAcknowledgement")}</span>{" "}
              <span className="text-slate-400">({getTranslation("reserve.step2.optionalPlaceholder")})</span>
            </span>
          </label>
          <p className="terms-notice-links text-xs leading-5 text-gray-600">
            {getTranslation("reserve.step2.termsNoticeSinglePrefix")} {" "}
            <button
              type="button"
              className="text-left text-blue-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2"
              onClick={() => setShowTerms(true)}
            >
              {getTranslation("reserve.step2.termsLink")}
            </button>{" "}{getTranslation("reserve.step2.termsNoticeSingleSuffix")}
            <span className="terms-notice-divider" aria-hidden="true">·</span>
            <button
              type="button"
              className="font-medium text-slate-700 underline decoration-slate-300 underline-offset-2 transition-colors hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
              onClick={() => setShowPrivacyNotice(true)}
            >
              {getTranslation("reserve.step2.privacyNoticeLink")}
            </button>{" "}
          </p>
        </div>
      </div>

      <Dialog open={showPrivacyNotice} onOpenChange={(open) => { setShowPrivacyNotice(open); if (!open) privacySwipe.reset() }}>
        <DialogContent portalContainer={dialogContainer} overlayClassName="reservation-legal-drawer-overlay" style={privacySwipe.style} className={`reservation-legal-drawer !top-auto !bottom-0 !translate-y-0 max-h-[90vh] max-w-2xl gap-0 overflow-hidden rounded-t-2xl p-0 sm:!top-[50%] sm:!bottom-auto sm:!translate-y-[-50%] sm:rounded-lg ${privacySwipe.isDragging ? "is-dragging" : ""}`}>
          <DialogHeader className="reservation-legal-drawer-header border-b border-slate-200 px-5 py-4 text-left sm:px-6" onPointerDown={privacySwipe.onPointerDown} onPointerMove={privacySwipe.onPointerMove} onPointerUp={privacySwipe.onPointerUp} onPointerCancel={privacySwipe.onPointerCancel}>
            <div className="reservation-legal-drawer-handle" aria-hidden="true" />
            <DialogTitle>{privacyNotice?.title || getTranslation("reserve.step2.privacyNoticeTitle")}</DialogTitle>
            <DialogDescription className="pt-1 leading-5">
              {privacyNotice?.introduction || getTranslation("reserve.step2.privacyLoading")}
            </DialogDescription>
            <button
              type="button"
              className="reservation-legal-drawer-close"
              aria-label={privacyNotice?.closeLabel || getTranslation("reserve.step2.privacyClose")}
              onClick={() => setShowPrivacyNotice(false)}
            >
              <X aria-hidden="true" />
            </button>
          </DialogHeader>

          <div className="reservation-legal-drawer-content max-h-[68vh] overflow-y-auto px-5 py-5 sm:px-6">
            {privacyNotice ? (
              <div className="space-y-5 text-sm leading-6 text-slate-600">
                <section className="rounded-xl bg-slate-50 p-4">
                  <h3 className="font-semibold text-slate-900">{privacyNotice.dataControllerLabel}</h3>
                  <p className="mt-1 font-medium text-slate-800">{privacyNotice.dataControllerName}</p>
                  <div className="mt-2 space-y-1 text-xs leading-5 text-slate-500">
                    <p>{privacyNotice.contactLabel}: {privacyNotice.contactEmail}</p>
                  </div>
                </section>

                {privacyNotice.sections.map((section) => (
                  <section key={section.heading}>
                    <h3 className="font-semibold text-slate-900">{section.heading}</h3>
                    {section.paragraphs?.map((paragraph) => (
                      <p key={paragraph} className="mt-2">{paragraph}</p>
                    ))}
                    {section.items && (
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {section.items.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    )}
                  </section>
                ))}

                <p className="border-t border-slate-200 pt-3 text-[11px] text-slate-400">
                  {privacyNotice.locale} · {privacyNotice.country} · {privacyNotice.version}
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-600">
                {getTranslation("reserve.step2.privacyUnavailable")}
              </p>
            )}
          </div>

          <DialogFooter className="border-t border-slate-200 px-5 py-3 sm:px-6">
            <button
              type="button"
              className="btn btn-primary w-full sm:w-auto"
              onClick={() => setShowPrivacyNotice(false)}
            >
              {privacyNotice?.closeLabel || getTranslation("reserve.step2.privacyClose")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showTerms} onOpenChange={(open) => { setShowTerms(open); if (!open) termsSwipe.reset() }}>
        <DialogContent portalContainer={dialogContainer} overlayClassName="reservation-legal-drawer-overlay" style={termsSwipe.style} className={`reservation-legal-drawer !top-auto !bottom-0 !translate-y-0 max-h-[90vh] max-w-2xl gap-0 overflow-hidden rounded-t-2xl p-0 sm:!top-[50%] sm:!bottom-auto sm:!translate-y-[-50%] sm:rounded-lg ${termsSwipe.isDragging ? "is-dragging" : ""}`}>
          <DialogHeader className="reservation-legal-drawer-header border-b border-slate-200 px-5 py-4 text-left sm:px-6" onPointerDown={termsSwipe.onPointerDown} onPointerMove={termsSwipe.onPointerMove} onPointerUp={termsSwipe.onPointerUp} onPointerCancel={termsSwipe.onPointerCancel}>
            <div className="reservation-legal-drawer-handle" aria-hidden="true" />
            <DialogTitle>{getTranslation("reserve.step2.termsLink")}</DialogTitle>
            <DialogDescription className="pt-1 leading-5">
              {getTranslation("reserve.step2.termsDescription")}
            </DialogDescription>
            <button
              type="button"
              className="reservation-legal-drawer-close"
              aria-label={getTranslation("reserve.step2.termsClose")}
              onClick={() => setShowTerms(false)}
            >
              <X aria-hidden="true" />
            </button>
          </DialogHeader>

          <div className="reservation-legal-drawer-content max-h-[68vh] overflow-y-auto px-5 py-5 sm:px-6">
            <TermsDrawerContent contactEmail={privacyNotice?.contactEmail || "support@reservevia.com"} />
          </div>

          <DialogFooter className="border-t border-slate-200 px-5 py-3 sm:px-6">
            <button
              type="button"
              className="btn btn-primary w-full sm:w-auto"
              onClick={() => setShowTerms(false)}
            >
              {getTranslation("reserve.step2.termsClose")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
