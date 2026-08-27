"use client"

import { useLanguage } from "@/context/language-context"
import { formatDate as formatLocalizedDate, formatTime as formatLocalizedTime } from "@/i18n"
import { useCallback, useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { AlertTriangle, Calendar, Clock, Users, Edit, X, CheckCircle, XCircle, MapPin, Sparkles } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  cancelReservation,
  cancelReservationWithManagementToken,
  getCustomerReservationByToken,
  getReservationEditAvailability,
  getReservationStatus,
  updateReservation,
  updateReservationWithManagementToken,
} from "@/app/actions/reservation-actions"
import { toast } from "@/hooks/use-toast"
import { ConsumerStatePage } from "@/components/consumer-state-page"

interface ReservationData {
  id: string
  restaurant_slug?: string
  restaurant_name: string
  customer_name: string
  customer_email: string
  customer_phone: string
  party_size: number
  reservation_date: string
  reservation_time: string
  special_requests?: string
  status?: string | null
  notes?: string | null
  created_at: string
}

type EditReservationForm = {
  customer_name: string
  customer_email: string
  customer_phone: string
  party_size: number | ""
  reservation_date: string
  reservation_time: string
  special_requests: string
}

type ReservationEditAvailability = {
  reservationEnabled: boolean
  openingTime: string
  closingTime: string
  slotDuration: number
  advanceBookingDays: number
  minAdvanceHours: number
  minPartySize: number
  maxPartySize: number
  allowedDays: number[]
  blockedDates: string[]
  reservationStartDate: string | null
  blockedIntervals: Array<{ date: string; start_time: string; end_time: string; message?: string }>
  notices: Array<{
    start_date: string
    end_date: string
    title?: string
    message: string
    active?: boolean
    recurring_weekly?: boolean
    recurring_days?: number[]
  }>
}

type TriggerStatus = "pending" | "confirmed" | "cancelled"

const getReservationDateTime = (reservation: Pick<ReservationData, "reservation_date" | "reservation_time">) => {
  const [year, month, day] = reservation.reservation_date.split("-").map((value) => Number.parseInt(value, 10) || 0)
  const [hours, minutes] = reservation.reservation_time.split(":").map((value) => Number.parseInt(value, 10) || 0)
  const date = new Date()
  date.setFullYear(year)
  date.setMonth((month || 1) - 1)
  date.setDate(day || 1)
  date.setHours(hours || 0, minutes || 0, 0, 0)
  return date
}

const parseLocalDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number)
  if (!year || !month || !day) return null
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null
}

const formatLocalDate = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

const timeToMinutes = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  return hours * 60 + minutes
}

const getAvailableTimes = (dateValue: string, settings: ReservationEditAvailability) => {
  const date = parseLocalDate(dateValue)
  const openingMinutes = timeToMinutes(settings.openingTime)
  const closingMinutes = timeToMinutes(settings.closingTime)
  if (!date || openingMinutes === null || closingMinutes === null || settings.slotDuration <= 0) return []

  const minimumDateTime = new Date(Date.now() + settings.minAdvanceHours * 60 * 60 * 1000)
  const blockedIntervals = settings.blockedIntervals.filter((interval) => interval.date === dateValue)
  const times: string[] = []
  for (let minutes = openingMinutes; minutes <= closingMinutes; minutes += settings.slotDuration) {
    const slotDateTime = new Date(date)
    slotDateTime.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
    if (slotDateTime < minimumDateTime) continue

    const isBlocked = blockedIntervals.some((interval) => {
      const start = timeToMinutes(interval.start_time)
      const end = timeToMinutes(interval.end_time)
      return start !== null && end !== null && minutes >= start && minutes < end
    })
    if (!isBlocked) times.push(`${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`)
  }
  return times
}

const getAvailableDates = (settings: ReservationEditAvailability) => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dates: string[] = []

  for (let offset = 0; offset < settings.advanceBookingDays; offset++) {
    const date = new Date(today)
    date.setDate(today.getDate() + offset)
    const value = formatLocalDate(date)
    const weekday = date.getDay() === 0 ? 7 : date.getDay()
    if (
      (settings.reservationStartDate && value < settings.reservationStartDate) ||
      !settings.allowedDays.includes(weekday) ||
      settings.blockedDates.includes(value) ||
      getAvailableTimes(value, settings).length === 0
    ) continue
    dates.push(value)
  }
  return dates
}

const getActiveNoticesForDate = (dateValue: string, settings: ReservationEditAvailability) => {
  const date = parseLocalDate(dateValue)
  if (!date) return []
  const weekday = date.getDay() === 0 ? 7 : date.getDay()

  return settings.notices.filter((notice) => {
    if (notice.active === false) return false
    if (notice.recurring_weekly) return notice.recurring_days?.includes(weekday) ?? false
    return dateValue >= notice.start_date && dateValue <= notice.end_date
  })
}

interface RecentReservationProps {
  restaurantSlug?: string
  restaurantName?: string
  customerManagementToken?: string
  triggerOnly?: boolean
  showTriggerStatus?: boolean
  triggerFallback?: ReactNode
  triggerFallbackWithStatus?: (statusBadge: ReactNode, status: TriggerStatus) => ReactNode
  triggerClassName?: string
  triggerLabel?: string
  triggerIcon?: ReactNode
}

export function RecentReservation({
  restaurantSlug,
  restaurantName,
  customerManagementToken,
  triggerOnly = false,
  showTriggerStatus = false,
  triggerFallback = null,
  triggerFallbackWithStatus,
  triggerClassName = "",
  triggerLabel,
  triggerIcon = <Edit className="h-4 w-4" aria-hidden="true" />,
}: RecentReservationProps) {
  const { getTranslation, currentLang } = useLanguage()
  const [reservations, setReservations] = useState<ReservationData[]>([])
  const [showPanel, setShowPanel] = useState(true)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showCancelDialog, setShowCancelDialog] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [isLoadingAvailability, setIsLoadingAvailability] = useState(false)
  const [isLoadingManagedReservation, setIsLoadingManagedReservation] = useState(Boolean(customerManagementToken))
  const [editAvailabilityState, setEditAvailabilityState] = useState<"idle" | "loading" | "ready" | "expired" | "noAvailability" | "closed" | "error">("idle")
  const [selectedReservation, setSelectedReservation] = useState<ReservationData | null>(null)
  const [editAvailability, setEditAvailability] = useState<ReservationEditAvailability | null>(null)
  const [editForm, setEditForm] = useState<EditReservationForm>({
    customer_name: "",
    customer_email: "",
    customer_phone: "",
    party_size: 2,
    reservation_date: "",
    reservation_time: "",
    special_requests: ""
  })
  const tokenAutoOpenedRef = useRef(false)

  useEffect(() => {
    let isActive = true

    const parseDT = (d?: string, t?: string) => {
      const [yy, mm, dd] = String(d || '').split('-').map((n) => parseInt(n, 10) || 0)
      const [hh, mi] = String(t || '00:00').split(':').map((n) => parseInt(n, 10) || 0)
      const x = new Date()
      x.setFullYear(yy)
      x.setMonth((mm || 1) - 1)
      x.setDate(dd || 1)
      x.setHours(hh || 0, mi || 0, 0, 0)
      return x
    }

    const loadRecentReservations = async () => {
      if (customerManagementToken) {
        setIsLoadingManagedReservation(true)
        try {
          const result = await getCustomerReservationByToken(customerManagementToken, currentLang, restaurantSlug)
          if (!isActive) return
          if (!result.success || !result.data) {
            toast({
              title: getTranslation("recentReservation.toast.errorTitle"),
              description: result.message || getTranslation("recentReservation.toast.errorDesc"),
              variant: "destructive",
            })
            return
          }
          setReservations([result.data as ReservationData])
          try {
            const cleanUrl = new URL(window.location.href)
            cleanUrl.searchParams.delete("manageToken")
            window.history.replaceState(window.history.state, "", cleanUrl.toString())
          } catch {}
        } catch (error) {
          console.error("Error loading reservation from management link:", error)
          if (isActive) {
            toast({
              title: getTranslation("recentReservation.toast.errorTitle"),
              description: getTranslation("recentReservation.toast.unexpected"),
              variant: "destructive",
            })
          }
        } finally {
          if (isActive) setIsLoadingManagedReservation(false)
        }
        return
      }

      setIsLoadingManagedReservation(false)
      const cookies = document.cookie.split(';')
      const listCookie = cookies.find((c) => c.trim().startsWith('recent_reservations='))
      let items: ReservationData[] = []

      if (listCookie) {
        try {
          items = JSON.parse(decodeURIComponent(listCookie.split('=')[1])) || []
        } catch (e) {
          console.error('Error parsing recent_reservations cookie:', e)
        }
      } else {
        // fallback: old single cookie
        const single = cookies.find((c) => c.trim().startsWith('recent_reservation='))
        if (single) {
          try {
            const one = JSON.parse(decodeURIComponent(single.split('=')[1]))
            if (one && one.id) items = [one]
            // clear old cookie
            document.cookie = 'recent_reservation=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/'
          } catch {}
        }
      }

      const scoped = (items || []).filter((item) => {
        if (!restaurantSlug && !restaurantName) return true
        return Boolean(
          (restaurantSlug && item.restaurant_slug === restaurantSlug) ||
          (restaurantName && item.restaurant_name === restaurantName),
        )
      })

      // Filter out expired
      const now = Date.now()
      const valid = scoped.filter((it) => parseDT(it.reservation_date, it.reservation_time).getTime() > now)

      if (valid.length) {
        setReservations(valid)
        // Respect previous hide choice
        try {
          const hidden = localStorage.getItem('recent_reservation_hidden') === '1'
          if (hidden) setShowPanel(false)
        } catch {}
        // persist filtered list and expiry as max
        const maxExpiry = valid.reduce((acc, it) => Math.max(acc, parseDT(it.reservation_date, it.reservation_time).getTime()), 0)
        const expiryDate = maxExpiry > now ? new Date(maxExpiry) : (() => { const e = new Date(); e.setHours(e.getHours() + 3); return e })()
        document.cookie = `recent_reservations=${encodeURIComponent(JSON.stringify(valid))}; expires=${expiryDate.toUTCString()}; path=/`

        // Hydrate status and manager notes together so cancelled/confirmed messages
        // render from the same reservation snapshot instead of racing separate updates.
        const statusResults = await Promise.all(valid.map(async (reservation) => {
          try {
            return { id: reservation.id, response: await getReservationStatus(reservation.id, currentLang) }
          } catch (error) {
            console.error('Error fetching reservation status:', error)
            return { id: reservation.id, response: null }
          }
        }))

        if (!isActive) return

        const statusById = new Map(statusResults.map((entry) => [entry.id, entry.response]))
        const hydratedReservations = valid.map((reservation) => {
          const result = statusById.get(reservation.id)
          if (!result?.success || !result.data) return reservation
          return { ...reservation, status: result.data.status, notes: result.data.notes }
        })

        setReservations(hydratedReservations)
        document.cookie = `recent_reservations=${encodeURIComponent(JSON.stringify(hydratedReservations))}; expires=${expiryDate.toUTCString()}; path=/`
      } else {
        // clear cookie if empty
        document.cookie = 'recent_reservations=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/'
      }
    }

    void loadRecentReservations()

    return () => {
      isActive = false
    }
  }, [currentLang, customerManagementToken, restaurantName, restaurantSlug, getTranslation])

  useEffect(() => {
    const nextExpiry = reservations
      .map((reservation) => getReservationDateTime(reservation).getTime())
      .filter((timestamp) => timestamp > Date.now())
      .sort((a, b) => a - b)[0]

    if (!nextExpiry) return
    const timeout = window.setTimeout(() => {
      setReservations((current) => current.filter((reservation) => getReservationDateTime(reservation).getTime() > Date.now()))
    }, Math.max(100, nextExpiry - Date.now() + 50))

    return () => window.clearTimeout(timeout)
  }, [reservations])

  const formatDate = (dateString: string) => {
    return formatLocalizedDate(dateString, currentLang, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }

  const formatTime = (timeString: string) => {
    const [hours, minutes] = timeString.split(':')
    const date = new Date()
    date.setHours(parseInt(hours), parseInt(minutes))
    return formatLocalizedTime(date, currentLang, { hour: "numeric", minute: "2-digit" })
  }

  const handleEditClick = useCallback(async (res: ReservationData) => {
    if (res) {
      setSelectedReservation(res)
      setEditAvailability(null)
      setEditForm({
        customer_name: res.customer_name,
        customer_email: res.customer_email,
        customer_phone: res.customer_phone,
        party_size: res.party_size,
        reservation_date: res.reservation_date,
        reservation_time: res.reservation_time,
        special_requests: res.special_requests || ""
      })
      setShowEditDialog(true)
      setIsLoadingAvailability(true)
      setEditAvailabilityState("loading")

      try {
        const result = await getReservationEditAvailability(res.id, currentLang)
        if (!result.success || !result.data) {
          const resultMessage = result.message || ""
          setEditAvailabilityState(/not found|unavailable|expired/i.test(resultMessage) ? "expired" : "error")
          toast({
            title: getTranslation('recentReservation.toast.errorTitle'),
            description: resultMessage || getTranslation('recentReservation.toast.errorDesc'),
            variant: "destructive",
          })
          return
        }

        const settings = result.data as ReservationEditAvailability
        const dates = getAvailableDates(settings)
        setEditAvailability(settings)
        setEditAvailabilityState(
          settings.reservationEnabled ? (dates.length > 0 ? "ready" : "noAvailability") : "closed",
        )
        setEditForm((current) => {
          const date = dates.includes(current.reservation_date) ? current.reservation_date : dates[0] || ""
          const times = date ? getAvailableTimes(date, settings) : []
          return {
            ...current,
            reservation_date: date,
            reservation_time: times.includes(current.reservation_time) ? current.reservation_time : times[0] || "",
            party_size: Math.min(Math.max(Number(current.party_size) || settings.minPartySize, settings.minPartySize), settings.maxPartySize),
          }
        })
      } catch (error) {
        console.error("Error loading reservation edit availability:", error)
        setEditAvailabilityState("error")
        toast({
          title: getTranslation('recentReservation.toast.errorTitle'),
          description: getTranslation('recentReservation.toast.unexpected'),
          variant: "destructive",
        })
      } finally {
        setIsLoadingAvailability(false)
      }
    }
  }, [currentLang, getTranslation])

  useEffect(() => {
    const reservation = reservations[0]
    const status = reservation?.status?.toLowerCase()
    if (
      !customerManagementToken ||
      tokenAutoOpenedRef.current ||
      !reservation ||
      status === "cancelled" ||
      status === "canceled"
    ) return

    tokenAutoOpenedRef.current = true
    void handleEditClick(reservation)
  }, [customerManagementToken, handleEditClick, reservations])

  const availableEditDates = editAvailability ? getAvailableDates(editAvailability) : []
  const availableEditTimes = editAvailability && editForm.reservation_date
    ? getAvailableTimes(editForm.reservation_date, editAvailability)
    : []
  const availablePartySizes = editAvailability
    ? Array.from(
        { length: editAvailability.maxPartySize - editAvailability.minPartySize + 1 },
        (_, index) => editAvailability.minPartySize + index
      )
    : []
  const activeEditNotices = editAvailability && editForm.reservation_date
    ? getActiveNoticesForDate(editForm.reservation_date, editAvailability)
    : []
  const editStateBlocksForm = ["expired", "noAvailability", "closed", "error"].includes(editAvailabilityState)
  const editStateVariant = editAvailabilityState === "expired"
    ? "expired"
    : editAvailabilityState === "noAvailability"
      ? "noAvailability"
      : editAvailabilityState === "closed"
        ? "closed"
        : "error"

  const handleSaveEdit = async () => {
    if (!selectedReservation) return
    
    setIsEditing(true)
    try {
      const normalizedPartySize = editForm.party_size === "" ? 1 : editForm.party_size
      const updateParams = {
        id: selectedReservation.id,
        customer_name: editForm.customer_name,
        customer_email: editForm.customer_email,
        customer_phone: editForm.customer_phone,
        party_size: normalizedPartySize,
        reservation_date: editForm.reservation_date,
        reservation_time: editForm.reservation_time,
        special_requests: editForm.special_requests || undefined,
        lang: currentLang,
      }
      const result = customerManagementToken
        ? await updateReservationWithManagementToken(customerManagementToken, updateParams)
        : await updateReservation(updateParams)

      if (result.success) {
        // Update the selected reservation in state and cookie
        const updatedReservation: ReservationData = {
          ...selectedReservation,
          ...editForm,
          party_size: normalizedPartySize,
          status: 'pending',
        }
        setReservations((prev) => prev.map((r) => (r.id === selectedReservation.id ? updatedReservation : r)))

        // Update list cookie with all active reservations and expiry at latest reservation time
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
        const active = reservations.map((r) => (r.id === selectedReservation.id ? updatedReservation : r))
          .filter((r) => parseDT(r.reservation_date, r.reservation_time).getTime() > Date.now())
        const maxExpiry = active.reduce((acc, it) => Math.max(acc, parseDT(it.reservation_date, it.reservation_time).getTime()), 0)
        const expiryDate = maxExpiry > Date.now() ? new Date(maxExpiry) : (() => { const e = new Date(); e.setHours(e.getHours() + 3); return e })()
        document.cookie = `recent_reservations=${encodeURIComponent(JSON.stringify(active))}; expires=${expiryDate.toUTCString()}; path=/`
        
        setShowEditDialog(false)
        toast({
          title: getTranslation('recentReservation.toast.successTitle'),
          description: getTranslation('recentReservation.toast.successDesc')
        })
      } else {
        toast({
          title: getTranslation('recentReservation.toast.errorTitle'),
          description: result.message || getTranslation('recentReservation.toast.errorDesc'),
          variant: "destructive"
        })
      }
    } catch (error) {
      console.error('Error updating reservation:', error)
      toast({
        title: getTranslation('recentReservation.toast.errorTitle'),
        description: getTranslation('recentReservation.toast.unexpected'),
        variant: "destructive"
      })
    } finally {
      setIsEditing(false)
    }
  }

  const handleDismiss = () => {
    // Hide panel but keep cookie so user can bring it back
    try {
      localStorage.setItem('recent_reservation_hidden', '1')
    } catch {}
    setShowPanel(false)
  }

  const removeReservationFromCookie = (reservationId: string) => {
    const listCookie = document.cookie.split(";").find((cookie) => cookie.trim().startsWith("recent_reservations="))
    if (!listCookie) return

    let items: ReservationData[] = []
    try {
      items = JSON.parse(decodeURIComponent(listCookie.split("=").slice(1).join("="))) || []
    } catch {
      items = []
    }

    const remaining = items.filter((item) => item.id !== reservationId)
    if (!remaining.length) {
      document.cookie = "recent_reservations=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/"
      return
    }

    const latestReservation = remaining.reduce((latest, reservation) => Math.max(latest, getReservationDateTime(reservation).getTime()), 0)
    document.cookie = `recent_reservations=${encodeURIComponent(JSON.stringify(remaining))}; expires=${new Date(latestReservation).toUTCString()}; path=/`
  }

  const handleCancelReservation = async () => {
    if (!selectedReservation) return
    setIsCancelling(true)
    try {
      const result = customerManagementToken
        ? await cancelReservationWithManagementToken(customerManagementToken, selectedReservation.id, currentLang)
        : await cancelReservation({
            id: selectedReservation.id,
            customer_email: selectedReservation.customer_email,
            customer_phone: selectedReservation.customer_phone,
            lang: currentLang,
          })

      if (!result.success) {
        toast({
          title: getTranslation("recentReservation.toast.errorTitle"),
          description: result.message || getTranslation("recentReservation.toast.cancelError"),
          variant: "destructive",
        })
        return
      }

      setReservations((current) => current.filter((reservation) => reservation.id !== selectedReservation.id))
      removeReservationFromCookie(selectedReservation.id)
      setShowCancelDialog(false)
      setShowEditDialog(false)
      toast({
        title: getTranslation("recentReservation.toast.cancelSuccessTitle"),
        description: getTranslation("recentReservation.toast.cancelSuccessDesc"),
      })
    } catch (error) {
      console.error("Error cancelling reservation:", error)
      toast({
        title: getTranslation("recentReservation.toast.errorTitle"),
        description: getTranslation("recentReservation.toast.cancelError"),
        variant: "destructive",
      })
    } finally {
      setIsCancelling(false)
    }
  }

  const handleShowPanel = () => {
    try {
      localStorage.removeItem('recent_reservation_hidden')
    } catch {}
    setShowPanel(true)
  }

  const upcomingReservations = reservations.filter(
    (reservation) => getReservationDateTime(reservation).getTime() > Date.now(),
  )
  const isCancelledReservation = (reservation: ReservationData) => {
    const status = reservation.status?.toLowerCase()
    return status === 'cancelled' || status === 'canceled'
  }
  const editableReservation = upcomingReservations.find((reservation) => !isCancelledReservation(reservation))
  const triggerReservation = editableReservation || upcomingReservations[0]
  const editableReservationStatus = triggerReservation?.status?.toLowerCase()
  const triggerStatus: TriggerStatus = editableReservationStatus === 'confirmed'
    ? 'confirmed'
    : editableReservationStatus === 'cancelled' || editableReservationStatus === 'canceled'
      ? 'cancelled'
      : 'pending'
  const triggerStatusClassName = triggerStatus === 'confirmed'
    ? 'border-green-200 bg-green-100 text-green-800'
    : triggerStatus === 'cancelled'
      ? 'border-red-200 bg-red-100 text-red-800'
      : 'border-orange-200 bg-orange-100 text-orange-800'
  const triggerStatusLabel = triggerStatus === "confirmed"
    ? getTranslation("common.status.confirmed")
    : triggerStatus === "cancelled"
      ? getTranslation("common.status.cancelled")
      : getTranslation("common.status.pending")
  const triggerButtonStatusClassName = `recent-reservation-trigger-status-${triggerStatus}`
  const renderTriggerStatusBadge = () => (
    <span
      role="status"
      className={`recent-reservation-trigger-status-badge ${triggerStatusClassName}`}
    >
      {triggerStatusLabel}
    </span>
  )
  const renderTriggerStatusNote = () => {
    const note = triggerReservation?.notes?.trim()
    if (!note || (triggerStatus !== "confirmed" && triggerStatus !== "cancelled")) return null

    return (
      <div
        className={`recent-reservation-trigger-note recent-reservation-trigger-note-${triggerStatus}`}
        role="status"
      >
        <AlertTriangle aria-hidden="true" />
        <span>{note}</span>
      </div>
    )
  }

  if (!reservations.length || (triggerOnly && !triggerReservation)) {
    if (triggerOnly && customerManagementToken && isLoadingManagedReservation) {
      return <span className="public-restaurant-reserve" aria-live="polite">{getTranslation("recentReservation.loadingReservation")}</span>
    }
    return triggerOnly ? triggerFallback : null
  }

  if (triggerOnly && !editableReservation) {
    return showTriggerStatus ? (
      <div className={`recent-reservation-trigger-fallback recent-reservation-trigger-fallback-${triggerStatus}`}>
        {triggerFallbackWithStatus ? triggerFallbackWithStatus(renderTriggerStatusBadge(), triggerStatus) : triggerFallback}
        {renderTriggerStatusNote()}
      </div>
    ) : triggerFallback
  }

  if (!triggerOnly && !showPanel) {
    return (
      <div className="w-full max-w-4xl mx-auto mb-6">
        <Card className="bg-white border-blue-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg text-blue-900">
                {getTranslation('recentReservation.title')}
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={handleShowPanel}
                className="text-blue-700 border-blue-300 hover:bg-blue-100"
              >
                <Calendar className="h-4 w-4 mr-1" />
                {getTranslation("recentReservation.viewReservations", { count: String(reservations.length) })}
              </Button>
            </div>
          </CardHeader>
        </Card>
      </div>
    )
  }
  const statusConfig: Record<string, { card: string; border: string; badge: string; icon: ReactNode }> = {
    pending: {
      card: 'from-yellow-50 to-amber-50',
      border: 'border-yellow-200',
      badge: 'bg-yellow-100 text-yellow-800',
      icon: <Clock className="h-3.5 w-3.5 mr-1 text-yellow-600" />,
    },
    confirmed: {
      card: 'from-green-50 to-emerald-50',
      border: 'border-green-200',
      badge: 'bg-green-100 text-green-800',
      icon: <CheckCircle className="h-3.5 w-3.5 mr-1 text-green-600" />,
    },
    cancelled: {
      card: 'from-red-50 to-rose-50',
      border: 'border-red-200',
      badge: 'bg-red-100 text-red-800',
      icon: <XCircle className="h-3.5 w-3.5 mr-1 text-red-600" />,
    },
  }

  return (
    <>
      {triggerOnly ? (
        showTriggerStatus ? (
          <div className="recent-reservation-trigger-group">
            <button
              type="button"
              className={`${triggerClassName} recent-reservation-trigger ${triggerButtonStatusClassName}`}
              onClick={() => {
                if (editableReservation) void handleEditClick(editableReservation)
              }}
              disabled={!editableReservation}
            >
              <span>{triggerLabel || getTranslation('recentReservation.edit')}</span>
              {renderTriggerStatusBadge()}
              {triggerIcon}
            </button>
            {renderTriggerStatusNote()}
          </div>
        ) : (
          <button
            type="button"
            className={triggerClassName}
            onClick={() => {
              if (editableReservation) void handleEditClick(editableReservation)
            }}
            disabled={!editableReservation}
          >
            <span>{triggerLabel || getTranslation('recentReservation.edit')}</span>
            {triggerIcon}
          </button>
        )
      ) : (
        <div className="w-full max-w-4xl mx-auto mb-6 px-3 sm:px-0">
          {reservations.map((reservation) => {
          const status = (reservation.status || 'pending') as 'pending' | 'confirmed' | 'cancelled' | string
          const cfg = statusConfig[status] || { card: 'from-blue-50 to-indigo-50', border: 'border-blue-200', badge: 'bg-blue-100 text-blue-800', icon: <Clock className="h-3.5 w-3.5 mr-1 text-blue-600" /> }
          const [y, m, d] = reservation.reservation_date.split('-').map((n) => parseInt(n, 10) || 0)
          const [hh, mm] = reservation.reservation_time.split(':').map((n) => parseInt(n, 10) || 0)
          const resDT = new Date()
          resDT.setFullYear(y)
          resDT.setMonth((m || 1) - 1)
          resDT.setDate(d || 1)
          resDT.setHours(hh || 0, mm || 0, 0, 0)
          const canEdit = new Date().getTime() < resDT.getTime() && status !== 'cancelled'

            return (
              <Card key={reservation.id} className={`mb-4 bg-gradient-to-r ${cfg.card} ${cfg.border}`}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base sm:text-lg text-gray-900 truncate">
                    {getTranslation('recentReservation.title')}
                  </CardTitle>
                  <div className="flex gap-2 flex-wrap items-center justify-end">
                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium shrink-0 ${cfg.badge}`}>
                      {cfg.icon}
                      {status === 'pending' && getTranslation('common.status.pending')}
                      {status === 'confirmed' && getTranslation('common.status.confirmed')}
                      {status === 'cancelled' && getTranslation('common.status.cancelled')}
                      {status !== 'pending' && status !== 'confirmed' && status !== 'cancelled' && String(status)}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEditClick(reservation)}
                      disabled={!canEdit}
                      className={`text-blue-700 border-blue-300 hover:bg-blue-100 ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <Edit className="h-4 w-4 mr-1" />
                      {getTranslation('recentReservation.edit')}
                    </Button>
                    {canEdit && <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedReservation(reservation)
                        setShowCancelDialog(true)
                      }}
                      className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                    >
                      {getTranslation("recentReservation.actions.cancelReservation")}
                    </Button>}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleDismiss}
                      className="text-gray-500 hover:text-gray-700"
                      title={getTranslation("recentReservation.hidePanel")}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="bg-blue-100 p-2 rounded-full shrink-0">
                      <Calendar className="h-4 w-4 text-blue-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs sm:text-sm text-gray-600">{getTranslation('recentReservation.date')}</p>
                      <p className="font-medium text-gray-900 truncate">{formatDate(reservation.reservation_date)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="bg-blue-100 p-2 rounded-full shrink-0">
                      <Clock className="h-4 w-4 text-blue-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs sm:text-sm text-gray-600">{getTranslation('recentReservation.time')}</p>
                      <p className="font-medium text-gray-900 truncate">{formatTime(reservation.reservation_time)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="bg-blue-100 p-2 rounded-full shrink-0">
                      <Users className="h-4 w-4 text-blue-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs sm:text-sm text-gray-600">{getTranslation('recentReservation.party')}</p>
                      <p className="font-medium text-gray-900 truncate">{reservation.party_size} {getTranslation('recentReservation.guestsSuffix')}</p>
                    </div>
                  </div>
                </div>
                <div className={`mt-4 pt-4 border-t ${cfg.border}`}>
                  <p className="text-sm text-gray-600 flex flex-wrap gap-x-1 min-w-0">
                    <span className="font-medium truncate max-w-full sm:max-w-[50%]">{reservation.restaurant_name}</span>
                    <span className="hidden sm:inline">•</span>
                    <span className="truncate max-w-full sm:max-w-[40%]">{reservation.customer_name}</span>
                  </p>
                  {reservation.special_requests && (
                    <p className="text-sm text-gray-500 mt-1 break-words whitespace-pre-line">
                      {getTranslation('recentReservation.specialRequestsPrefix')} {reservation.special_requests}
                    </p>
                  )}
                  {(status === 'confirmed' || status === 'cancelled') && reservation.notes && (
                    <div
                      className={`mt-3 p-3 rounded-md border text-sm break-words whitespace-pre-line ${
                        status === 'confirmed'
                          ? 'border-green-300 bg-green-50 text-green-800'
                          : 'border-red-300 bg-red-50 text-red-800'
                      }`}
                    >
                      {reservation.notes}
                    </div>
                  )}
                </div>
              </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="left-0 top-0 h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-0 bg-[#eef3f8] p-0 sm:left-1/2 sm:top-1/2 sm:h-auto sm:max-h-[92vh] sm:w-[96vw] sm:max-w-5xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:border">
          <div className="flex h-full min-h-0 flex-col sm:h-auto sm:max-h-[92vh]">
            <div className="border-b border-white/60 bg-white/65 px-4 pb-4 pt-6 shadow-sm backdrop-blur sm:px-5 sm:pt-4">
              <DialogHeader className="gap-3">
                <DialogTitle className="sr-only">{getTranslation('recentReservation.dialogTitle')}</DialogTitle>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <div className="inline-flex max-w-full items-center gap-2 rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white sm:tracking-[0.22em]">
                      <Sparkles className="h-3.5 w-3.5" />
                      <span className="truncate">{getTranslation('recentReservation.dialogTitle')}</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="rounded-full border-white/70 bg-white px-2.5 py-0.5 text-[11px] text-slate-700 shadow-sm">
                    {selectedReservation?.restaurant_name || getTranslation('recentReservation.title')}
                  </Badge>
                  <Badge variant="outline" className="rounded-full border-white/70 bg-white px-2.5 py-0.5 text-[11px] text-slate-700 shadow-sm">
                    <Calendar className="mr-1 h-3 w-3" />
                    {editForm.reservation_date ? formatDate(editForm.reservation_date) : getTranslation('recentReservation.form.date')}
                  </Badge>
                  <Badge variant="outline" className="rounded-full border-white/70 bg-white px-2.5 py-0.5 text-[11px] text-slate-700 shadow-sm">
                    <Clock className="mr-1 h-3 w-3" />
                    {editForm.reservation_time ? formatTime(editForm.reservation_time) : getTranslation('recentReservation.form.time')}
                  </Badge>
                  <Badge variant="outline" className="rounded-full border-white/70 bg-white px-2.5 py-0.5 text-[11px] text-slate-700 shadow-sm">
                    <Users className="mr-1 h-3 w-3" />
                    {editForm.party_size || 1} {getTranslation('recentReservation.guestsSuffix')}
                  </Badge>
                </div>
              </DialogHeader>
            </div>

            {editStateBlocksForm && (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <ConsumerStatePage
                  variant={editStateVariant}
                  compact={true}
                  onRetry={editAvailabilityState === "error" && selectedReservation ? () => void handleEditClick(selectedReservation) : undefined}
                />
              </div>
            )}

            <ScrollArea className={`min-h-0 flex-1 ${editStateBlocksForm ? "hidden" : ""}`}>
              <form
                id="recent-reservation-edit-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  void handleSaveEdit()
                }}
                className="px-4 py-4 sm:px-5"
              >
                <div className="grid gap-4 xl:grid-cols-2">
                  <Card className="overflow-hidden rounded-2xl border border-white/70 bg-white shadow-[0_14px_35px_rgba(15,23,42,0.08)] ring-1 ring-black/5">
                    <CardHeader className="border-b border-slate-100 bg-white/80 px-4 py-3">
                      <CardTitle className="text-sm font-semibold text-slate-950">
                        {getTranslation('recentReservation.title')}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-3 p-4">
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="customer_name" className="text-xs font-medium text-slate-700">
                          {getTranslation('recentReservation.form.name')}
                        </Label>
                        <Input
                          id="customer_name"
                          className="h-10 rounded-xl border-slate-200 bg-white shadow-sm transition-shadow focus-visible:shadow-md"
                          value={editForm.customer_name}
                          onChange={(e) => setEditForm(prev => ({ ...prev, customer_name: e.target.value }))}
                          required
                        />
                      </div>

                      <Accordion type="single" collapsible className="rounded-xl border border-slate-100 bg-slate-50 px-3">
                        <AccordionItem value="contact" className="border-b-0">
                          <AccordionTrigger className="py-3 text-xs font-medium text-slate-700 hover:no-underline">
                            {getTranslation('recentReservation.form.email')} / {getTranslation('recentReservation.form.phone')}
                          </AccordionTrigger>
                          <AccordionContent className="grid gap-3 pb-3 pt-0 sm:grid-cols-2">
                            <div className="flex flex-col gap-1.5">
                              <Label htmlFor="customer_email" className="text-xs font-medium text-slate-700">
                                {getTranslation('recentReservation.form.email')}
                              </Label>
                              <Input
                                id="customer_email"
                                type="email"
                                className="h-10 rounded-xl border-slate-200 bg-white shadow-sm transition-shadow focus-visible:shadow-md"
                                value={editForm.customer_email}
                                onChange={(e) => setEditForm(prev => ({ ...prev, customer_email: e.target.value }))}
                                required
                              />
                            </div>

                            <div className="flex flex-col gap-1.5">
                              <Label htmlFor="customer_phone" className="text-xs font-medium text-slate-700">
                                {getTranslation('recentReservation.form.phone')}
                              </Label>
                              <Input
                                id="customer_phone"
                                className="h-10 rounded-xl border-slate-200 bg-white shadow-sm transition-shadow focus-visible:shadow-md"
                                value={editForm.customer_phone}
                                onChange={(e) => setEditForm(prev => ({ ...prev, customer_phone: e.target.value }))}
                                required
                              />
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
                    </CardContent>
                  </Card>

                  <Card className="overflow-hidden rounded-2xl border border-white/70 bg-white shadow-[0_14px_35px_rgba(15,23,42,0.08)] ring-1 ring-black/5">
                    <CardHeader className="border-b border-slate-100 bg-white/80 px-4 py-3">
                      <CardTitle className="text-sm font-semibold text-slate-950">
                        {getTranslation('reserve.header.yourReservation')}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-3 p-4">
                      <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                        <div className="flex items-start gap-3">
                          <MapPin className="mt-0.5 h-4 w-4 text-slate-500" />
                          <div className="min-w-0">
                            <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                              {getTranslation('reserve.confirmation.restaurant')}
                            </div>
                            <div className="mt-1 truncate text-sm font-medium text-slate-900">
                              {selectedReservation?.restaurant_name}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="reservation_date" className="text-xs font-medium text-slate-700">
                            {getTranslation('recentReservation.form.date')}
                          </Label>
                          <select
                            id="reservation_date"
                            className="h-10 rounded-xl border-slate-200 bg-white px-3 text-sm shadow-sm transition-shadow focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
                            value={editForm.reservation_date}
                            onChange={(e) => {
                              const reservation_date = e.target.value
                              const times = editAvailability ? getAvailableTimes(reservation_date, editAvailability) : []
                              setEditForm(prev => ({ ...prev, reservation_date, reservation_time: times[0] || "" }))
                            }}
                            disabled={isLoadingAvailability || !editAvailability || !editAvailability.reservationEnabled}
                            required
                          >
                            {isLoadingAvailability && <option>{getTranslation("recentReservation.loadingDates")}</option>}
                            {!isLoadingAvailability && !editAvailability && <option>{getTranslation("recentReservation.datesUnavailable")}</option>}
                            {editAvailability && !editAvailability.reservationEnabled && <option>{getTranslation("recentReservation.unavailable")}</option>}
                            {editAvailability?.reservationEnabled && availableEditDates.map((date) => (
                              <option key={date} value={date}>{formatDate(date)}</option>
                            ))}
                          </select>
                        </div>

                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="reservation_time" className="text-xs font-medium text-slate-700">
                            {getTranslation('recentReservation.form.time')}
                          </Label>
                          <select
                            id="reservation_time"
                            className="h-10 rounded-xl border-slate-200 bg-white px-3 text-sm shadow-sm transition-shadow focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
                            value={editForm.reservation_time}
                            onChange={(e) => setEditForm(prev => ({ ...prev, reservation_time: e.target.value }))}
                            disabled={isLoadingAvailability || !editAvailability || !editAvailability.reservationEnabled || availableEditTimes.length === 0}
                            required
                          >
                            {isLoadingAvailability && <option>{getTranslation("recentReservation.loadingTimes")}</option>}
                            {!isLoadingAvailability && editAvailability?.reservationEnabled && availableEditTimes.map((time) => (
                              <option key={time} value={time}>{formatTime(time)}</option>
                            ))}
                            {editAvailability?.reservationEnabled && availableEditTimes.length === 0 && <option>{getTranslation("recentReservation.noTimes")}</option>}
                          </select>
                        </div>

                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="party_size" className="text-xs font-medium text-slate-700">
                            {getTranslation('recentReservation.form.partySize')}
                          </Label>
                          <select
                            id="party_size"
                            className="h-10 rounded-xl border-slate-200 bg-white px-3 text-sm shadow-sm transition-shadow focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
                            value={editForm.party_size}
                            onChange={(e) => setEditForm(prev => ({ ...prev, party_size: parseInt(e.target.value, 10) || 1 }))}
                            disabled={isLoadingAvailability || !editAvailability || !editAvailability.reservationEnabled}
                            required
                          >
                          {isLoadingAvailability && <option>{getTranslation("recentReservation.loadingPartySizes")}</option>}
                            {editAvailability?.reservationEnabled && availablePartySizes.map((size) => (
                              <option key={size} value={size}>{size}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {activeEditNotices.length > 0 && (
                    <div className="space-y-3 xl:col-span-2">
                      {activeEditNotices.map((notice, index) => (
                        <div
                          key={`${notice.start_date}-${notice.end_date}-${index}`}
                          className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
                          role="status"
                        >
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                          <div>
                            {notice.title?.trim() && <p className="font-semibold">{notice.title}</p>}
                            <p>{notice.message}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <Card className="overflow-hidden rounded-2xl border border-white/70 bg-white shadow-[0_14px_35px_rgba(15,23,42,0.08)] ring-1 ring-black/5 xl:col-span-2">
                    <CardHeader className="border-b border-slate-100 bg-white/80 px-4 py-3">
                      <CardTitle className="text-sm font-semibold text-slate-950">
                        {getTranslation('recentReservation.form.specialRequests')}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4">
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="special_requests" className="text-xs font-medium text-slate-700">
                          {getTranslation('recentReservation.form.specialRequests')}
                        </Label>
                        <Textarea
                          id="special_requests"
                          value={editForm.special_requests}
                          onChange={(e) => setEditForm(prev => ({ ...prev, special_requests: e.target.value }))}
                          rows={3}
                          className="min-h-[92px] rounded-xl border-slate-200 bg-white shadow-sm transition-shadow focus-visible:shadow-md"
                        />
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </form>
            </ScrollArea>

            <div className={`border-t border-white/60 bg-white/70 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur sm:px-5 sm:pb-3 ${editStateBlocksForm ? "hidden" : ""}`}>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowCancelDialog(true)}
                  disabled={isEditing || isCancelling}
                  className="h-10 w-full rounded-xl text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:mr-auto sm:w-auto"
                >
                  {getTranslation("recentReservation.actions.cancelReservation")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowEditDialog(false)}
                  disabled={isEditing}
                  className="h-10 w-full rounded-xl sm:w-auto"
                >
                  {getTranslation('recentReservation.actions.cancel')}
                </Button>
                <Button
                  type="submit"
                  form="recent-reservation-edit-form"
                  loading={isEditing}
                  disabled={isLoadingAvailability || !editAvailability?.reservationEnabled || !editForm.reservation_date || !editForm.reservation_time}
                  className="h-10 w-full rounded-xl bg-slate-950 px-5 text-white hover:bg-slate-800 sm:w-auto"
                >
                  {isEditing ? getTranslation('recentReservation.actions.saving') : getTranslation('recentReservation.actions.save')}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent className="rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{getTranslation("recentReservation.cancelDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>{getTranslation("recentReservation.cancelDialog.description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCancelling}>{getTranslation("recentReservation.actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); void handleCancelReservation() }} disabled={isCancelling} className="bg-rose-600 text-white hover:bg-rose-700">
              {isCancelling ? getTranslation("recentReservation.actions.cancelling") : getTranslation("recentReservation.actions.confirmCancel")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
