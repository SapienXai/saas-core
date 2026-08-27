"use client"

import { useLanguage } from "@/context/language-context"
import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { AppHeader } from "./app-header"
import { ReservationStep1 } from "./reservation-step1"
import { ReservationStep2 } from "./reservation-step2"
import { createReservation, getRestaurantByName, getRestaurantBySlug, getActiveReservationAreas, getPrivacyNoticeSettings } from "@/app/actions/reservation-actions"
// Server actions are used for data access to avoid client RLS issues
import type { Restaurant, ReservationArea } from "@/types/supabase"
import type { PrivacyNoticeContent } from "@/lib/privacy-notice"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { OrbLoader } from "@/components/ui/orb-loader"
import { ReservationConfirmation } from "./reservation-confirmation"
import { ConsumerStatePage } from "@/components/consumer-state-page"
import { formatCustomerReservationTime } from "@/lib/reservation-display"
import Image from "next/image"
import { getPlatformUrl } from "@/lib/platform-urls"
import { RESERVEVIA_LOGO_LIGHT } from "@/lib/brand-assets"
import { formatDate as formatLocalizedDate, resolveLanguage } from "@/i18n"
import { trackMarketingEventOnce } from "@/lib/marketing/analytics"
interface ReservationAppProps {
  initialRestaurant: string
  initialRestaurantSlug?: string
  initialDate?: string
  initialTime?: string
  initialPartySize?: number
  embedded?: boolean
  onBack?: () => void
  backHref?: string
}

function parseInitialDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date()
  const [year, month, day] = value.split("-").map(Number)
  const parsed = new Date(year, month - 1, day)
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day ? parsed : new Date()
}

export function ReservationApp({ initialRestaurant, initialRestaurantSlug, initialDate, initialTime, initialPartySize, embedded = false, onBack, backHref }: ReservationAppProps) {
  const submissionIdRef = useRef<string>(typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `rv-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const { currentLang, getTranslation } = useLanguage()
  const router = useRouter()
  const [currentStep, setCurrentStep] = useState(1)
  const [restaurantData, setRestaurantData] = useState<Restaurant | null>(null)
  const [restaurantLookupState, setRestaurantLookupState] = useState<"loading" | "ready" | "unavailable" | "error">("loading")
  const [restaurantLookupAttempt, setRestaurantLookupAttempt] = useState(0)
  const restaurantName = restaurantData?.name || initialRestaurant
  const [partySize, setPartySize] = useState(() => String(Number.isInteger(initialPartySize) && (initialPartySize || 0) > 0 ? initialPartySize : 2))
  const [selectedDate, setSelectedDate] = useState(() => parseInitialDate(initialDate))
  const [selectedTime, setSelectedTime] = useState(() => /^\d{2}:\d{2}$/.test(initialTime || "") ? initialTime as string : "17:00")
  const [reservationAreas, setReservationAreas] = useState<ReservationArea[]>([])
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null)
  const [customerName, setCustomerName] = useState("")
  const [customerPhone, setCustomerPhone] = useState("")
  const [customerEmail, setCustomerEmail] = useState("")
  const [specialRequests, setSpecialRequests] = useState("")
  const [minGuestAge, setMinGuestAge] = useState<number | null>(null)
  const [maxGuestAge, setMaxGuestAge] = useState<number | null>(null)
  const [reservationType, setReservationType] = useState("meal")
  const [message, setMessage] = useState("")
  const [isSuccess, setIsSuccess] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [reservationComplete, setReservationComplete] = useState(false)
  const [isClient, setIsClient] = useState(false)
  const [showStep2Errors, setShowStep2Errors] = useState(false)
  const [privacyNotice, setPrivacyNotice] = useState<PrivacyNoticeContent | null>(null)
  const [hasReservationAvailability, setHasReservationAvailability] = useState<boolean | null>(null)
  const appContentRef = useRef<HTMLDivElement | null>(null)
  const dialogContainerRef = useRef<HTMLDivElement | null>(null)
  const embeddedBackHandler = useCallback(() => {
    if (currentStep === 2) {
      setCurrentStep(1)
      return
    }
    if (onBack) {
      onBack()
      return
    }
    if (backHref) router.push(backHref)
  }, [backHref, currentStep, onBack, router])
  const headerBackHandler = onBack || backHref ? embeddedBackHandler : undefined
  const ReservationRoot = embedded ? "div" : "main"

  // Check if we're on the client side
  useEffect(() => {
    setIsClient(true)
  }, [])

  useEffect(() => {
    if (!isClient) return

    const container = appContentRef.current
    window.requestAnimationFrame(() => {
      container?.scrollTo({ top: 0, behavior: "auto" })
      window.scrollTo({ top: 0, behavior: "auto" })
      document.documentElement.scrollTop = 0
      document.body.scrollTop = 0
    })
  }, [currentStep, isClient])

  // Fetch restaurant data early to get reservation settings
  useEffect(() => {
    let active = true

    const fetchRestaurantData = async () => {
      if (restaurantData) {
        setRestaurantLookupState("ready")
        return
      }

      if (!initialRestaurantSlug && !initialRestaurant) {
        setRestaurantLookupState("unavailable")
        return
      }

      setRestaurantLookupState("loading")
      try {
        const fetched = initialRestaurantSlug
          ? await getRestaurantBySlug(initialRestaurantSlug)
          : await getRestaurantByName(initialRestaurant)
        if (!active) return
        if (fetched) {
          setRestaurantData(fetched as unknown as Restaurant)
          setRestaurantLookupState("ready")
        } else {
          setRestaurantLookupState("unavailable")
        }
      } catch (error) {
        console.error("Error fetching restaurant data:", error)
        if (active) setRestaurantLookupState("error")
      }
    }

    fetchRestaurantData()

    return () => {
      active = false
    }
  }, [initialRestaurant, initialRestaurantSlug, restaurantData, restaurantLookupAttempt])

  const retryRestaurantLookup = useCallback(() => {
    setRestaurantData(null)
    setRestaurantLookupState("loading")
    setRestaurantLookupAttempt((attempt) => attempt + 1)
  }, [])

  const handleAvailabilityChange = useCallback((available: boolean) => {
    setHasReservationAvailability(available)
  }, [])

  useEffect(() => {
    let isActive = true

    getPrivacyNoticeSettings(
      restaurantData?.name || restaurantName,
      restaurantData?.phone,
      currentLang
    )
      .then((content) => {
        if (isActive) setPrivacyNotice(content)
      })
      .catch((error) => {
        console.error("Error fetching privacy notice:", error)
        if (isActive) setPrivacyNotice(null)
      })

    return () => {
      isActive = false
    }
  }, [currentLang, restaurantData?.name, restaurantData?.phone, restaurantName])

  // Fetch active reservation areas when we have a restaurant
  useEffect(() => {
    const fetchAreas = async () => {
      if (restaurantData?.id) {
        try {
          const areas = await getActiveReservationAreas(restaurantData.id)
          setReservationAreas(areas as unknown as ReservationArea[])
          // Do not auto-select an area; keep it optional
          // If previously selected area no longer exists, clear selection
          if (selectedAreaId && !(areas || []).some((a: any) => a.id === selectedAreaId)) {
            setSelectedAreaId(null)
          }
        } catch (e) {
          console.error("Error fetching reservation areas:", e)
          setReservationAreas([])
          setSelectedAreaId(null)
        }
      } else {
        setReservationAreas([])
        setSelectedAreaId(null)
      }
    }
    fetchAreas()
  }, [restaurantData?.id, selectedAreaId])

  // No alternative fetching; show a simple message and a Home button when closed

  const getHeaderTitle = () => {
    return restaurantName
  }

  const getHeaderSubtitle = () => {
    return ""
  }

  const handleContinue = async () => {
    if (currentStep === 1) {
      if (!selectedTime) {
        setMessage(getTranslation("reserve.messages.selectTime"))
        setIsSuccess(false)
        return
      }
      setCurrentStep(2)
      setMessage("")
      setShowStep2Errors(false)
    } else {
      await handleSubmitReservation()
    }
  }

  const handleSubmitReservation = async () => {
    if (!customerName || !customerPhone || !customerEmail || minGuestAge === null || maxGuestAge === null) {
      setShowStep2Errors(true)
      // setMessage(getTranslation("reserve.messages.namePhoneEmailRequired"))
      setIsSuccess(false)
      return
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(customerEmail)) {
      setShowStep2Errors(true)
      setMessage(getTranslation("reserve.step2.errors.emailInvalid"))
      setIsSuccess(false)
      return
    }

    let effectiveRestaurant = restaurantData
    if (!effectiveRestaurant) {
      try {
        // Fallback: resolve by the stable slug when available, while keeping
        // existing name-based reservation URLs working.
        const fetched = initialRestaurantSlug
          ? await getRestaurantBySlug(initialRestaurantSlug)
          : await getRestaurantByName(initialRestaurant)
        if (fetched) {
          setRestaurantData(fetched as unknown as Restaurant)
          effectiveRestaurant = fetched as unknown as Restaurant
        } else {
          setMessage(getTranslation("reserve.messages.restaurantNotFound"))
          setIsSuccess(false)
          return
        }
      } catch (e) {
        console.error("Server lookup failed for restaurant:", restaurantName, e)
        setMessage(getTranslation("reserve.messages.unexpectedError"))
        setIsSuccess(false)
        return
      }
    }

    setIsLoading(true)

    try {
      // Format date for database (YYYY-MM-DD) - avoid timezone issues
      const formatDateToYYYYMMDD = (date: Date) => {
        const year = date.getFullYear()
        const month = (date.getMonth() + 1).toString().padStart(2, "0")
        const day = date.getDate().toString().padStart(2, "0")
        return `${year}-${month}-${day}`
      }
      const formattedDate = formatDateToYYYYMMDD(selectedDate)
      const ageRangeLabel = getTranslation("reserve.step2.guestAgeRangeNote", {
        min: minGuestAge ?? "",
        max: maxGuestAge ?? "",
      })
      const specialRequestsWithAgeRange = [ageRangeLabel, specialRequests.trim()].filter(Boolean).join("\n")

      const result = await createReservation({
        restaurantId: effectiveRestaurant!.id,
        reservationAreaId: selectedAreaId || null,
        partySize: Number.parseInt(partySize),
        reservationDate: formattedDate,
        reservationTime: selectedTime,
        customerName,
        customerPhone,
        customerEmail,
        specialRequests: specialRequestsWithAgeRange || undefined,
        reservationType,
        lang: currentLang,
        minGuestAge,
        maxGuestAge,
        submissionId: submissionIdRef.current,
      })

      if (result.success) {
        setMessage(result.message)
        setIsSuccess(true)
        setReservationComplete(true)
        trackMarketingEventOnce("first_reservation_received", `reservevia.first-reservation-tracked.${effectiveRestaurant!.id}`, { source: "reservation" })
        
        // Save reservation to cookie for 3 hours
        if (result.data) {
          const restaurantSlug = initialRestaurantSlug || effectiveRestaurant?.slug || undefined
          const reservationData = {
            id: result.data.id,
            restaurant_slug: restaurantSlug,
            restaurant_name: restaurantName,
            customer_name: customerName,
            customer_email: customerEmail,
            customer_phone: customerPhone,
            party_size: Number.parseInt(partySize),
            reservation_date: formattedDate,
            reservation_time: selectedTime,
            special_requests: specialRequestsWithAgeRange || undefined,
            status: "pending" as const,
            notes: null as string | null,
            created_at: new Date().toISOString()
          }
          
          // Merge into recent_reservations list cookie (array)
          const parseDT = (d: string, t: string) => {
            const [yy, mm, dd] = d.split('-').map((n) => parseInt(n, 10) || 0)
            const [hh, mi] = t.split(':').map((n) => parseInt(n, 10) || 0)
            const x = new Date()
            x.setFullYear(yy)
            x.setMonth((mm || 1) - 1)
            x.setDate(dd || 1)
            x.setHours(hh || 0, mi || 0, 0, 0)
            return x
          }

          const cookies = document.cookie.split(';')
          const listCookie = cookies.find((c) => c.trim().startsWith('recent_reservations='))
          let items: any[] = []
          if (listCookie) {
            try {
              items = JSON.parse(decodeURIComponent(listCookie.split('=')[1])) || []
            } catch {}
          } else {
            // migrate from single cookie if present
            const single = cookies.find((c) => c.trim().startsWith('recent_reservation='))
            if (single) {
              try {
                const one = JSON.parse(decodeURIComponent(single.split('=')[1]))
                if (one && one.id) items = [one]
                // clear old single cookie
                document.cookie = 'recent_reservation=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/'
              } catch {}
            }
          }

          // add/replace by id
          const without = items.filter((it) => it.id !== reservationData.id)
          const nextItems = [...without, reservationData]

          // remove expired entries and compute max expiry
          const now = Date.now()
          const validItems = nextItems.filter((it) => {
            const dt = parseDT(it.reservation_date, it.reservation_time)
            return dt.getTime() > now
          })
          const maxExpiry = validItems.reduce((acc: number, it: any) => {
            const dt = parseDT(it.reservation_date, it.reservation_time).getTime()
            return Math.max(acc, dt)
          }, 0)

          // safety fallback
          const expiryDate = maxExpiry > now ? new Date(maxExpiry) : (() => { const e = new Date(); e.setHours(e.getHours() + 3); return e })()

          const cookieValue = encodeURIComponent(JSON.stringify(validItems))
          document.cookie = `recent_reservations=${cookieValue}; expires=${expiryDate.toUTCString()}; path=/`
        }
      } else {
        setMessage(result.message)
        setIsSuccess(false)
      }
    } catch (error) {
      console.error("Error submitting reservation:", error)
      setMessage(getTranslation("reserve.messages.unexpectedError"))
      setIsSuccess(false)
    } finally {
      setIsLoading(false)
    }
  }

  const getDisplayDate = (dateObj: Date, langParam: string, includeDayName = true) => {
    const effectiveLang = langParam || currentLang
    if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) {
      return getTranslation("reserve.messages.invalidDateShort")
    }
    const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }
    if (includeDayName) {
      options.weekday = "short"
    }
    return formatLocalizedDate(dateObj, resolveLanguage(effectiveLang), options)
  }

  if (!isClient) {
    return <div className="p-8">{getTranslation("reserve.loadingForm")}</div>
  }

  if (restaurantLookupState === "loading") {
    return (
      <div className="reservation-app">
        <AppHeader restaurantName={initialRestaurant} subtitle="" showBackButton={Boolean(headerBackHandler)} onBack={headerBackHandler} />
        <div className="app-content flex items-center justify-center" ref={appContentRef}>
          <OrbLoader label={getTranslation("common.loading")} state="searching" />
        </div>
      </div>
    )
  }

  if (restaurantLookupState === "unavailable" || restaurantLookupState === "error") {
    return (
      <div className="reservation-app">
        <AppHeader restaurantName={initialRestaurant} subtitle="" showBackButton={Boolean(headerBackHandler)} onBack={headerBackHandler} />
        <div className="app-content" ref={appContentRef}>
          <ConsumerStatePage
            variant={restaurantLookupState === "error" ? "error" : "unavailable"}
            compact={true}
            onRetry={restaurantLookupState === "error" ? retryRestaurantLookup : undefined}
          />
        </div>
      </div>
    )
  }

  if (reservationComplete) {
    return (
      <div className="reservation-app">
        <AppHeader
          restaurantName={restaurantName}
          subtitle=""
          showBackButton={Boolean(headerBackHandler)}
          onBack={headerBackHandler}
        />
        <div className="app-content" ref={appContentRef}>
          <ReservationConfirmation
            restaurantName={restaurantName}
            restaurantSlug={initialRestaurantSlug}
            date={getDisplayDate(selectedDate, currentLang, true)}
            time={formatCustomerReservationTime(selectedTime)}
            partySize={partySize}
          />
        </div>
      </div>
    )
  }

  // If this restaurant is closed for reservations, show a friendly consumer state.
  const isClosed = restaurantData && restaurantData.reservation_enabled === false
  if (isClosed) {
    return (
      <div className="reservation-app">
        <AppHeader
          restaurantName={restaurantName}
          subtitle=""
          showBackButton={true}
          currentStep={1}
          onBack={headerBackHandler}
        />

        <div className="app-content" ref={appContentRef}>
          <ConsumerStatePage variant="closed" compact={true} />
        </div>
      </div>
    )
  }

  return (
    <ReservationRoot aria-busy={isLoading} className="reservation-app-root">
      <div className="reservation-app" ref={dialogContainerRef}>
        {isLoading && (
          <div className="reservation-submit-overlay" aria-live="polite" aria-busy="true">
            <div className="reservation-submit-overlay-card">
              <OrbLoader
                label={getTranslation("reserve.footer.submittingReservationButton")}
                state="working"
                size="md"
              />
            </div>
          </div>
        )}
        <AppHeader
          restaurantName={getHeaderTitle()}
          subtitle={getHeaderSubtitle()}
          showBackButton={true}
          currentStep={currentStep}
          onBack={headerBackHandler}
        />

        <div className={currentStep === 2 ? "app-content app-content-step2" : "app-content app-content-step1"}>
          {currentStep === 1 ? (
            <ReservationStep1
              restaurantName={restaurantName}
              partySize={partySize}
              setPartySize={setPartySize}
              selectedDate={selectedDate}
              setSelectedDate={setSelectedDate}
              selectedTime={selectedTime}
              setSelectedTime={setSelectedTime}
              restaurant={restaurantData}
              areas={reservationAreas}
              selectedAreaId={selectedAreaId}
              setSelectedAreaId={setSelectedAreaId}
              onAvailabilityChange={handleAvailabilityChange}
            />
          ) : (
            <ReservationStep2
              restaurantName={restaurantName}
              partySize={partySize}
              selectedDate={selectedDate}
              selectedTime={selectedTime}
              customerName={customerName}
              setCustomerName={setCustomerName}
              customerPhone={customerPhone}
              setCustomerPhone={setCustomerPhone}
              customerEmail={customerEmail}
              setCustomerEmail={setCustomerEmail}
              specialRequests={specialRequests}
              setSpecialRequests={setSpecialRequests}
              minGuestAge={minGuestAge}
              setMinGuestAge={setMinGuestAge}
              maxGuestAge={maxGuestAge}
              setMaxGuestAge={setMaxGuestAge}
              reservationType={reservationType}
              setReservationType={setReservationType}
              mealOnlyReservations={restaurantData?.meal_only_reservations || false}
              getDisplayDate={getDisplayDate}
              attemptedSubmit={showStep2Errors}
              selectedAreaId={selectedAreaId}
              areas={reservationAreas}
              privacyNotice={privacyNotice}
              dialogContainer={dialogContainerRef.current}
            />
          )}

          {message && (
            <div className="mt-4">
              <Alert variant={isSuccess ? "default" : "destructive"}>
                <AlertTitle>{isSuccess ? getTranslation("common.success") : getTranslation("common.error")}</AlertTitle>
                <AlertDescription>{message}</AlertDescription>
              </Alert>
            </div>
          )}
        </div>

        {hasReservationAvailability !== false && <div className={currentStep === 2 ? "app-footer app-footer-sticky-step2" : "app-footer app-footer-sticky-step1"}>
          <button className="btn btn-primary" onClick={handleContinue} disabled={isLoading || isSuccess}>
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
                {getTranslation("reserve.footer.submittingReservationButton")}
              </>
            ) : isSuccess ? (
              getTranslation("reserve.footer.emailOpenedButton")
            ) : currentStep === 1 ? (
              getTranslation("reserve.footer.continueButton")
            ) : (
              getTranslation("reserve.footer.confirmButton")
            )}
          </button>
          {currentStep === 1 && (
            <div className="partnership-text partnership-text-footer">
              <a href={getPlatformUrl("/")} aria-label="Visit Reservevia">
                <Image src={RESERVEVIA_LOGO_LIGHT} alt="Reservevia" width={22} height={22} />
              </a>
              <span>{getTranslation("reserve.step1.bookingEngineText")}</span>
            </div>
          )}
        </div>}
      </div>
    </ReservationRoot>
  )
}
