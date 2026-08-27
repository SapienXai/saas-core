"use client"

import { Button } from "@/components/ui/button"
import { ArrowUpRight, Bell, CalendarDays, CheckCheck, Clock, MapPin, Menu, Trash2, Users, Wifi, WifiOff, X } from "lucide-react"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import { useState, useEffect, useMemo, useRef, type PointerEvent } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useLanguage } from "@/context/language-context"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { useManageContext } from "@/context/manage-context"
import { startNavigationFeedback } from "@/components/navigation-feedback"
import { OrbLoader } from "@/components/ui/orb-loader"
import { ManagePushNotificationSwitch } from "@/components/manage/manage-push-notification-switch"
import { formatDate as formatLocalizedDate, formatTime as formatLocalizedTime } from "@/i18n"

interface ManageHeaderProps {
  user: {
    email: string
    name: string
  }
  toggleSidebar: () => void
}

type NotificationEventType = "created" | "updated" | "cancelled"

interface Notification {
  id: string
  reservation_id: string
  event_type: NotificationEventType
  customer_name: string
  restaurant_name: string
  reservation_area_name?: string | null
  party_size: number
  reservation_time: string
  reservation_date: string
  created_at: string
  read: boolean
}

interface PopupNotification {
  id: string
  reservation_id: string
  event_type: NotificationEventType
  customer_name: string
  restaurant_name: string
  reservation_area_name?: string | null
  party_size: number
  reservation_time: string
  reservation_date: string
  created_at: string
}

const READ_NOTIFICATIONS_STORAGE_KEY = "felix-read-notifications"
const DISMISSED_NOTIFICATIONS_STORAGE_KEY = "felix-dismissed-notifications"
const MAX_VISIBLE_POPUPS = 2
const POPUP_EXIT_DURATION_MS = 220
const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  starter: "Starter",
  pro: "Pro",
  business: "Business",
}
const MANAGE_OFFLINE_CACHE_STORAGE_KEYS = [
  "felix:manage:emergency-offline-cache:v1",
  "reservevia:manage:emergency-offline-cache:v1",
  READ_NOTIFICATIONS_STORAGE_KEY,
  DISMISSED_NOTIFICATIONS_STORAGE_KEY,
]

function readStoredIds(key: string) {
  if (typeof window === "undefined") {
    return new Set<string>()
  }

  try {
    const raw = window.localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [])
  } catch {
    return new Set<string>()
  }
}

function storeIds(key: string, ids: Set<string>) {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.setItem(key, JSON.stringify(Array.from(ids).slice(-200)))
}

function clearSupabaseAuthStorage() {
  if (typeof window === "undefined") {
    return
  }

  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index)
    if (key?.startsWith("sb-") && key.endsWith("-auth-token")) {
      window.localStorage.removeItem(key)
    }
  }

  for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = window.sessionStorage.key(index)
    if (key?.startsWith("sb-") && key.endsWith("-auth-token")) {
      window.sessionStorage.removeItem(key)
    }
  }
}

async function clearManageOfflineBrowserCaches() {
  if (typeof window === "undefined") {
    return
  }

  MANAGE_OFFLINE_CACHE_STORAGE_KEYS.forEach((key) => window.localStorage.removeItem(key))

  if ("serviceWorker" in navigator) {
    try {
      const registration = await navigator.serviceWorker.getRegistration("/sw.js")
      const worker = registration?.active || registration?.waiting || registration?.installing
      worker?.postMessage({ type: "CLEAR_MANAGE_OFFLINE_CACHE" })
    } catch (error) {
      console.warn("Failed to notify service worker about cache cleanup:", error)
    }
  }

  if ("caches" in window) {
    try {
      const cacheNames = await window.caches.keys()
      await Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith("manage-offline-") || cacheName.startsWith("reservevia-manage-"))
          .map((cacheName) => window.caches.delete(cacheName))
      )
    } catch (error) {
      console.warn("Failed to clear manage offline caches:", error)
    }
  }
}

function getNotificationId(reservation: any, eventType: NotificationEventType) {
  const timestamp = eventType === "created" ? reservation.created_at : reservation.updated_at || new Date().toISOString()
  return `${reservation.id}-${eventType}-${timestamp}`
}

function getCustomerNotificationEventType(reservation: any, previousReservation?: any): Exclude<NotificationEventType, "created"> | null {
  const summary = reservation.last_update_summary as { source?: string; updatedAt?: string } | null
  if (summary?.source !== "customer" || !summary.updatedAt || reservation.last_updated_by_user_id) {
    return null
  }

  const updatedAt = new Date(reservation.updated_at).getTime()
  const summaryAt = new Date(summary.updatedAt).getTime()
  const previousUpdatedAt = previousReservation?.updated_at ? new Date(previousReservation.updated_at).getTime() : null

  if (previousUpdatedAt && Number.isFinite(previousUpdatedAt) && summaryAt <= previousUpdatedAt) {
    return null
  }

  if (!Number.isFinite(updatedAt) || !Number.isFinite(summaryAt) || Math.abs(updatedAt - summaryAt) >= 30000) {
    return null
  }

  return reservation.status === "cancelled" ? "cancelled" : "updated"
}

export function ManageHeader({ toggleSidebar }: ManageHeaderProps) {
  const supabase = getSupabaseBrowserClient()
  const router = useRouter()
  const pathname = usePathname()
  const { currentLang, getTranslation } = useLanguage()
  const { currentWorkspace } = useManageContext()
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [popupNotifications, setPopupNotifications] = useState<PopupNotification[]>([])
  const [isOnline, setIsOnline] = useState(true)
  const audioContextRef = useRef<AudioContext | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const popupDragStartRef = useRef<Record<string, number>>({})
  const popupWasDraggedRef = useRef<Set<string>>(new Set())
  const popupExitTimersRef = useRef<Record<string, number>>({})
  const readNotificationIdsRef = useRef<Set<string>>(new Set())
  const dismissedNotificationIdsRef = useRef<Set<string>>(new Set())
  const knownNotificationIdsRef = useRef<Set<string>>(new Set())
  const [popupDragOffsets, setPopupDragOffsets] = useState<Record<string, number>>({})
  const [popupExitDirections, setPopupExitDirections] = useState<Record<string, 1 | -1>>({})
  const [popupAdvanceKey, setPopupAdvanceKey] = useState(0)
  const [popupEntryIndex, setPopupEntryIndex] = useState<number | null>(null)
  const [popupEntryMode, setPopupEntryMode] = useState<"right" | "up">("right")
  const [isClearingPopups, setIsClearingPopups] = useState(false)

  const unreadCount = useMemo(
    () => notifications.reduce((count, notification) => count + (notification.read ? 0 : 1), 0),
    [notifications]
  )

  const unreadLabel = unreadCount > 9 ? "9+" : String(unreadCount)
  const currentPlanKey = currentWorkspace?.plan?.key || null
  const currentPlanLabel = currentPlanKey ? PLAN_LABELS[currentPlanKey] || currentWorkspace?.plan?.name || currentPlanKey : null
  const workspacePlanLabel = currentPlanLabel ? getTranslation("manage.common.workspacePlan", { plan: currentPlanLabel }) : null
  const planBadgeClass = currentPlanKey === "free"
    ? "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/25 dark:bg-sky-400/10 dark:text-sky-200"
    : currentPlanKey === "starter"
      ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200"
      : currentPlanKey === "pro"
        ? "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-400/25 dark:bg-orange-400/10 dark:text-orange-200"
        : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-200"
  const pageTitle = pathname.startsWith("/onboarding/new")
    ? getTranslation("manage.sidebar.restaurants")
    : pathname.startsWith("/manage/reservations")
    ? getTranslation("manage.sidebar.reservations")
    : pathname.startsWith("/manage/reports")
      ? getTranslation("manage.sidebar.reports")
    : pathname.startsWith("/manage/seating")
      ? getTranslation("manage.sidebar.seating")
      : pathname.startsWith("/manage/restaurants")
        ? getTranslation("manage.sidebar.restaurants")
        : pathname.startsWith("/manage/users") || pathname.startsWith("/manage/team")
          ? getTranslation("manage.sidebar.team")
          : pathname.startsWith("/manage/pwa")
            ? getTranslation("manage.sidebar.managementApp")
          : getTranslation("manage.sidebar.dashboard")

  const goToReservation = (reservationId: string) => {
    startNavigationFeedback()
    router.push(`/manage/reservations?reservationId=${encodeURIComponent(reservationId)}`)
  }

  useEffect(() => {
    if (typeof window === "undefined") return

    const updateConnectionStatus = () => {
      setIsOnline(navigator.onLine)
    }

    updateConnectionStatus()
    window.addEventListener("online", updateConnectionStatus)
    window.addEventListener("offline", updateConnectionStatus)

    return () => {
      window.removeEventListener("online", updateConnectionStatus)
      window.removeEventListener("offline", updateConnectionStatus)
    }
  }, [])

  useEffect(() => {
    readNotificationIdsRef.current = readStoredIds(READ_NOTIFICATIONS_STORAGE_KEY)
    dismissedNotificationIdsRef.current = readStoredIds(DISMISSED_NOTIFICATIONS_STORAGE_KEY)

    // Initialize audio context
    if (typeof window !== 'undefined') {
      try {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
      } catch {
        audioContextRef.current = null
      }
    }

    let lastCheckedTime = new Date().toISOString()
    let pollInterval: NodeJS.Timeout

    // Subscribe to real-time changes
    const channel = supabase
      .channel('reservations-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'reservations'
        },
        async (payload) => {
          const newReservation = payload.new as any
          
          // Get complete reservation data with restaurant info using join query
          let restaurantName = 'Unknown Restaurant'
          let areaName: string | null = null
          
          try {
            const { data: reservationWithRestaurant, error } = await supabase
              .from('reservations')
              .select(`
                id,
                customer_name,
                party_size,
                reservation_time,
                reservation_date,
                created_at,
                updated_at,
                booked_by_user_id,
                booked_by_label,
                last_update_summary,
                last_updated_by_user_id,
                restaurants(name),
                reservation_areas(name)
              `)
              .eq('id', newReservation.id)
              .single()
            
            if (error) {
              console.error('Error fetching reservation with restaurant:', JSON.stringify(error, null, 2))
              // Fallback: try direct restaurant fetch
              const { data: restaurant } = await supabase
                .from('restaurants')
                .select('name')
                .eq('id', newReservation.restaurant_id)
                .single()
              
              restaurantName = restaurant?.name || 'Unknown Restaurant'
            } else {
               restaurantName = (reservationWithRestaurant.restaurants as any)?.name
               areaName = (reservationWithRestaurant as any)?.reservation_areas?.name || null
               
               // If restaurantName is still not found, try direct fetch
               if (!restaurantName) {
                 const { data: restaurant } = await supabase
                   .from('restaurants')
                   .select('name')
                   .eq('id', newReservation.restaurant_id)
                   .single()
                 
                 restaurantName = restaurant?.name || 'Unknown Restaurant'
               }
             }
          } catch (fetchError) {
            console.error('Failed to fetch restaurant name:', fetchError)
            // Keep default 'Unknown Restaurant'
          }

          const notification: Notification = {
            id: getNotificationId(newReservation, "created"),
            reservation_id: newReservation.id,
            event_type: "created",
            customer_name: newReservation.customer_name,
            restaurant_name: restaurantName,
            reservation_area_name: areaName,
            party_size: newReservation.party_size,
            reservation_time: newReservation.reservation_time,
            reservation_date: newReservation.reservation_date,
            created_at: newReservation.created_at,
            read: readNotificationIdsRef.current.has(newReservation.id)
          }

          if (dismissedNotificationIdsRef.current.has(notification.id)) {
            return
          }
          if (knownNotificationIdsRef.current.has(notification.id)) {
            return
          }

          knownNotificationIdsRef.current.add(notification.id)
          setNotifications(prev => {
            return [notification, ...prev]
          })
          
          // Create popup notification
          const popupNotification: PopupNotification = {
            id: notification.id,
            reservation_id: newReservation.id,
            event_type: "created",
            customer_name: newReservation.customer_name,
            restaurant_name: restaurantName,
            reservation_area_name: areaName,
            party_size: newReservation.party_size,
            reservation_time: newReservation.reservation_time,
            reservation_date: newReservation.reservation_date,
            created_at: newReservation.created_at
          }
          
          if (!notification.read) {
            setPopupNotifications(prev => {
              if (prev.some(item => item.id === popupNotification.id)) return prev
              return [...prev, popupNotification]
            })
            playNotificationSound()
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'reservations'
        },
        async (payload) => {
          const updatedReservation = payload.new as any
          const eventType = getCustomerNotificationEventType(updatedReservation, payload.old)
          if (!eventType) {
            return
          }

          let restaurantName = 'Unknown Restaurant'
          let areaName: string | null = null

          try {
            const { data: reservationWithRestaurant, error } = await supabase
              .from('reservations')
              .select(`
                id,
                customer_name,
                party_size,
                reservation_time,
                reservation_date,
                created_at,
                updated_at,
                booked_by_user_id,
                booked_by_label,
                last_update_summary,
                last_updated_by_user_id,
                restaurants(name),
                reservation_areas(name)
              `)
              .eq('id', updatedReservation.id)
              .single()

            if (error) {
              console.error('Error fetching updated reservation with restaurant:', JSON.stringify(error, null, 2))
              const { data: restaurant } = await supabase
                .from('restaurants')
                .select('name')
                .eq('id', updatedReservation.restaurant_id)
                .single()

              restaurantName = restaurant?.name || 'Unknown Restaurant'
            } else {
              restaurantName = (reservationWithRestaurant.restaurants as any)?.name || 'Unknown Restaurant'
              areaName = (reservationWithRestaurant as any)?.reservation_areas?.name || null
            }
          } catch (fetchError) {
            console.error('Failed to fetch updated reservation name:', fetchError)
          }

          const notification: Notification = {
            id: getNotificationId(updatedReservation, eventType),
            reservation_id: updatedReservation.id,
            event_type: eventType,
            customer_name: updatedReservation.customer_name,
            restaurant_name: restaurantName,
            reservation_area_name: areaName,
            party_size: updatedReservation.party_size,
            reservation_time: updatedReservation.reservation_time,
            reservation_date: updatedReservation.reservation_date,
            created_at: updatedReservation.updated_at || new Date().toISOString(),
            read: readNotificationIdsRef.current.has(getNotificationId(updatedReservation, eventType))
          }

          if (dismissedNotificationIdsRef.current.has(notification.id)) {
            return
          }
          if (knownNotificationIdsRef.current.has(notification.id)) {
            return
          }

          knownNotificationIdsRef.current.add(notification.id)
          setNotifications(prev => [notification, ...prev])

          const popupNotification: PopupNotification = {
            id: notification.id,
            reservation_id: updatedReservation.id,
            event_type: eventType,
            customer_name: updatedReservation.customer_name,
            restaurant_name: restaurantName,
            reservation_area_name: areaName,
            party_size: updatedReservation.party_size,
            reservation_time: updatedReservation.reservation_time,
            reservation_date: updatedReservation.reservation_date,
            created_at: updatedReservation.updated_at || new Date().toISOString()
          }

          if (!notification.read) {
            setPopupNotifications(prev => {
              if (prev.some(item => item.id === popupNotification.id)) return prev
              return [...prev, popupNotification]
            })
            playNotificationSound()
          }
        }
      )
      .subscribe(() => {
        // Keep reconciliation polling active even when the channel reports
        // SUBSCRIBED. Replication or RLS can briefly drop an event without
        // closing the websocket, and notifications must remain reliable.
        if (!pollInterval) {
          pollInterval = setInterval(async () => {
            if (!navigator.onLine || document.visibilityState === "hidden") return

            try {
              const pollCutoff = new Date().toISOString()
              const { data: newReservations, error } = await supabase
                .from('reservations')
                .select(`
                  *,
                  restaurants(name),
                  reservation_areas(name)
                `)
                .gte('created_at', lastCheckedTime)
                .lt('created_at', pollCutoff)
                .order('created_at', { ascending: false })

              if (error) {
                console.error('Error polling for new reservations:', error)
                return
              }
              
              if (newReservations && newReservations.length > 0) {
                newReservations.forEach((reservation: any) => {
                  const restaurantName = reservation.restaurants?.name || 'Unknown Restaurant';
                  const isRead = readNotificationIdsRef.current.has(reservation.id)

                  const notification: Notification = {
                    id: getNotificationId(reservation, "created"),
                    reservation_id: reservation.id,
                    event_type: "created",
                    customer_name: reservation.customer_name,
                    restaurant_name: restaurantName,
                    reservation_area_name: (reservation as any)?.reservation_areas?.name || null,
                    party_size: reservation.party_size,
                    reservation_time: reservation.reservation_time,
                    reservation_date: reservation.reservation_date,
                    created_at: reservation.created_at,
                    read: isRead
                  }

                  if (dismissedNotificationIdsRef.current.has(notification.id)) {
                    return
                  }
                  if (knownNotificationIdsRef.current.has(notification.id)) {
                    return
                  }
                  
                  knownNotificationIdsRef.current.add(notification.id)
                  setNotifications(prev => {
                    return [notification, ...prev]
                  })
                  
                  // Create popup notification
                  const popupNotification: PopupNotification = {
                    id: notification.id,
                    reservation_id: reservation.id,
                    event_type: "created",
                    customer_name: reservation.customer_name,
                    restaurant_name: restaurantName,
                    reservation_area_name: (reservation as any)?.reservation_areas?.name || null,
                    party_size: reservation.party_size,
                    reservation_time: reservation.reservation_time,
                    reservation_date: reservation.reservation_date,
                    created_at: reservation.created_at
                  }
                  
                  if (!isRead) {
                    setPopupNotifications(prev => {
                      // Avoid duplicates
                      if (prev.some(p => p.id === popupNotification.id)) return prev
                      return [...prev, popupNotification]
                    })
                    playNotificationSound()
                  }
                })
                
              }
              lastCheckedTime = pollCutoff
            } catch (error) {
              console.error('Error polling for new reservations:', error)
            }
          }, 10000) // Poll every 10 seconds
        }
      })

    // Click outside handler
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowNotifications(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)

    return () => {
      channel.unsubscribe()
      document.removeEventListener('mousedown', handleClickOutside)
      if (pollInterval) {
        clearInterval(pollInterval)
      }
    }
  }, [supabase])

  const playNotificationSound = () => {
    if (audioContextRef.current) {
      const oscillator = audioContextRef.current.createOscillator()
      const gainNode = audioContextRef.current.createGain()
      
      oscillator.connect(gainNode)
      gainNode.connect(audioContextRef.current.destination)
      
      oscillator.frequency.setValueAtTime(800, audioContextRef.current.currentTime)
      gainNode.gain.setValueAtTime(0.3, audioContextRef.current.currentTime)
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContextRef.current.currentTime + 0.5)
      
      oscillator.start(audioContextRef.current.currentTime)
      oscillator.stop(audioContextRef.current.currentTime + 0.5)
    }
  }

  const markAsRead = (notificationId: string) => {
    readNotificationIdsRef.current.add(notificationId)
    storeIds(READ_NOTIFICATIONS_STORAGE_KEY, readNotificationIdsRef.current)
    setNotifications(prev => 
      prev.map(notification => 
        notification.id === notificationId 
          ? { ...notification, read: true }
          : notification
      )
    )
  }

  const markAllAsRead = () => {
    setNotifications(prev => {
      const next = prev.map(notification => {
        readNotificationIdsRef.current.add(notification.id)
        return { ...notification, read: true }
      })

      storeIds(READ_NOTIFICATIONS_STORAGE_KEY, readNotificationIdsRef.current)
      return next
    })
  }

  const dismissNotification = (notificationId: string) => {
    dismissedNotificationIdsRef.current.add(notificationId)
    storeIds(DISMISSED_NOTIFICATIONS_STORAGE_KEY, dismissedNotificationIdsRef.current)
    setNotifications(prev => prev.filter(notification => notification.id !== notificationId))
  }

  const closePopupNotification = (notificationId: string) => {
    const exitTimer = popupExitTimersRef.current[notificationId]
    if (exitTimer !== undefined) {
      window.clearTimeout(exitTimer)
      delete popupExitTimersRef.current[notificationId]
    }

    setPopupNotifications(prev => prev.filter(popup => popup.id !== notificationId))
    setPopupDragOffsets(prev => {
      const remaining = { ...prev }
      delete remaining[notificationId]
      return remaining
    })
    setPopupExitDirections(prev => {
      const remaining = { ...prev }
      delete remaining[notificationId]
      return remaining
    })
  }

  const markPopupAsReadAndClose = (notificationId: string) => {
    markAsRead(notificationId)
    closePopupNotification(notificationId)
  }

  const markAllPopupNotificationsAsRead = () => {
    if (popupNotifications.length === 0 || isClearingPopups) return

    setIsClearingPopups(true)
    Object.values(popupExitTimersRef.current).forEach((timer) => window.clearTimeout(timer))
    popupExitTimersRef.current = {}
    popupNotifications.forEach((popup) => markAsRead(popup.id))

    window.setTimeout(() => {
      setPopupNotifications([])
      setPopupDragOffsets({})
      setPopupExitDirections({})
      setPopupEntryIndex(null)
      setIsClearingPopups(false)
    }, POPUP_EXIT_DURATION_MS)
  }

  const handlePopupPointerDown = (notificationId: string, event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") return
    popupDragStartRef.current[notificationId] = event.clientX
    popupWasDraggedRef.current.delete(notificationId)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePopupPointerMove = (notificationId: string, event: PointerEvent<HTMLDivElement>) => {
    const startX = popupDragStartRef.current[notificationId]
    if (startX === undefined) return

    const offset = event.clientX - startX
    if (Math.abs(offset) > 6) popupWasDraggedRef.current.add(notificationId)
    setPopupDragOffsets(prev => ({ ...prev, [notificationId]: Math.max(-180, Math.min(180, offset)) }))
  }

  const handlePopupPointerEnd = (notificationId: string) => {
    if (popupExitDirections[notificationId]) return

    const offset = popupDragOffsets[notificationId] ?? 0
    delete popupDragStartRef.current[notificationId]

    if (Math.abs(offset) >= 72) {
      const exitDirection: 1 | -1 = offset >= 0 ? 1 : -1
      const exitingPopupIndex = popupNotifications.findIndex((popup) => popup.id === notificationId)
      setPopupExitDirections(prev => ({ ...prev, [notificationId]: exitDirection }))
      setPopupDragOffsets(prev => ({ ...prev, [notificationId]: exitDirection * 420 }))

      const exitTimer = window.setTimeout(() => {
        markPopupAsReadAndClose(notificationId)
        setPopupAdvanceKey(prev => prev + 1)
        setPopupEntryIndex(exitingPopupIndex)
        setPopupEntryMode("up")

        window.setTimeout(() => {
          setPopupEntryMode("right")
        }, POPUP_EXIT_DURATION_MS + 80)
      }, POPUP_EXIT_DURATION_MS)

      popupExitTimersRef.current[notificationId] = exitTimer
      return
    }

    setPopupDragOffsets(prev => ({ ...prev, [notificationId]: 0 }))
  }

  const formatReservationDate = (date: string) => {
    return formatLocalizedDate(`${date}T12:00:00`, currentLang, {
      day: "numeric",
      month: "long",
      weekday: "long",
    })
  }

  const formatNotificationBody = (notification: Pick<Notification | PopupNotification, "restaurant_name" | "reservation_date" | "party_size" | "customer_name">) => {
    return [
      notification.restaurant_name,
      formatReservationDate(notification.reservation_date),
      `${notification.party_size} Pax`,
      notification.customer_name,
    ].filter(Boolean).join(" - ")
  }

  const formatPopupSummary = (notification: Pick<Notification | PopupNotification, "restaurant_name" | "customer_name">) => {
    return [notification.restaurant_name, notification.customer_name].filter(Boolean).join(" · ")
  }

  const getNotificationTitle = (eventType: NotificationEventType) => {
    const key = eventType === "created"
      ? "manage.notifications.newReservation"
      : eventType === "cancelled"
        ? "manage.notifications.cancelledReservation"
        : "manage.notifications.updatedReservation"
    return getTranslation(key)
  }

  const formatShortReservationDate = (date: string) => {
    return formatLocalizedDate(`${date}T12:00:00`, currentLang, {
      day: "numeric",
      month: "short",
      weekday: "short",
    })
  }

  const formatCreatedTime = (date: string) => {
    return formatLocalizedTime(date, currentLang, {
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const visiblePopupNotifications = popupNotifications.slice(0, MAX_VISIBLE_POPUPS)
  const hiddenPopupCount = Math.max(0, popupNotifications.length - visiblePopupNotifications.length)

  const openPopupReservation = (popup: PopupNotification) => {
    if (popupWasDraggedRef.current.delete(popup.id)) return
    markPopupAsReadAndClose(popup.id)
    goToReservation(popup.reservation_id)
  }

  const openNotificationCenterFromPopups = () => {
    setPopupNotifications([])
    setPopupDragOffsets({})
    setShowNotifications(true)
  }

  const handleSignOut = async () => {
    if (isSigningOut) {
      return
    }

    setIsSigningOut(true)

    try {
      const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration("/sw.js") : undefined
      const subscription = await registration?.pushManager.getSubscription()
      const pushCleanup = subscription
        ? fetch("/api/push-notifications/subscribe", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: subscription.endpoint }),
          }).catch(() => undefined)
        : Promise.resolve()
      const subscriptionCleanup = subscription?.unsubscribe().catch(() => undefined)
      const { error } = await supabase.auth.signOut({ scope: "local" })
      if (error) {
        console.warn("Supabase sign out failed:", error)
      }

      // Push/cache cleanup is best-effort and must not hold the logout
      // navigation hostage after the local session has been cleared.
      void Promise.allSettled([pushCleanup, subscriptionCleanup, clearManageOfflineBrowserCaches()])
    } catch (error) {
      console.warn("Supabase sign out failed:", error)
    }

    clearSupabaseAuthStorage()

    window.location.replace("/auth/signout")
  }

  useEffect(() => {
    const signOutFromSidebar = () => {
      void handleSignOut()
    }

    window.addEventListener("felix-manage-sign-out", signOutFromSidebar)
    return () => window.removeEventListener("felix-manage-sign-out", signOutFromSidebar)
  })

  return (
    <>
      {isSigningOut && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/25 backdrop-blur-sm" role="status" aria-live="polite" aria-label={getTranslation("manage.common.signOut")}>
          <OrbLoader label={getTranslation("manage.common.signOut")} theme="dark" state="working" />
        </div>
      )}
      <header className="sticky top-0 z-30 shrink-0 border-b border-slate-200/80 bg-white/85 backdrop-blur-xl transition-colors dark:border-white/10 dark:bg-[#0b0c0f]/85">
      <div className="flex h-14 items-center justify-between px-3 sm:h-16 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon" onClick={toggleSidebar} className="manage-sidebar-toggle mr-1 rounded-xl hover:bg-slate-100 dark:hover:bg-white/10 md:hidden" title={getTranslation("manage.common.openSidebar")} aria-controls="manage-sidebar-desktop">
            <Menu className="h-5 w-5" />
            <span className="sr-only">{getTranslation("manage.common.toggleSidebar")}</span>
          </Button>
          <button
            type="button"
            onClick={() => router.push("/manage")}
            className="min-w-0 text-left transition-opacity hover:opacity-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 dark:focus-visible:ring-white/70 dark:focus-visible:ring-offset-[#0b0c0f]"
            aria-label={getTranslation("manage.common.goToDashboard")}
            title={getTranslation("manage.common.goToDashboard")}
          >
            <div className="flex min-w-0 items-center gap-1.5">
              <p className="min-w-0 truncate text-[8px] font-bold uppercase leading-none tracking-[0.12em] text-slate-400 dark:text-slate-500 sm:text-[9px] sm:tracking-[0.16em]">{currentWorkspace?.workspace?.name || getTranslation("manage.common.workspaceFallback")}</p>
              {currentPlanLabel && <span title={workspacePlanLabel || undefined} aria-label={workspacePlanLabel || undefined} className={`inline-flex h-4 shrink-0 items-center rounded-md border px-1.5 text-[8px] font-bold uppercase leading-none tracking-[0.08em] sm:text-[9px] ${planBadgeClass}`}>{currentPlanLabel}</span>}
            </div>
            <h1 className="mt-0.5 truncate text-base font-bold leading-none tracking-tight text-slate-950 dark:text-white sm:text-lg">{pageTitle}</h1>
          </button>
          <Badge
            variant="outline"
            className={cn(
              "ml-2 hidden h-6 gap-1 rounded-full px-2 text-[10px] font-bold uppercase leading-none sm:inline-flex",
              isOnline
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10"
            )}
          >
            {isOnline ? <Wifi className="h-2.5 w-2.5" /> : <WifiOff className="h-2.5 w-2.5" />}
            {isOnline ? getTranslation("manage.offline.statusOnline") : getTranslation("manage.offline.statusOffline")}
          </Badge>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <div className="relative" ref={dropdownRef}>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => setShowNotifications(!showNotifications)}
              title={getTranslation("manage.common.notifications")}
              className={cn(
                "relative h-11 w-11 rounded-full border border-transparent transition-all sm:h-10 sm:w-10",
                showNotifications
                  ? "border-slate-200 bg-slate-950 text-white hover:bg-slate-900 hover:text-white"
                  : "hover:border-slate-200 hover:bg-slate-100"
              )}
            >
              <Bell className="h-6 w-6 sm:h-5 sm:w-5" />
              {unreadCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-rose-500 px-1 text-[10px] font-bold leading-none text-white shadow-sm">
                  {unreadLabel}
                </span>
              )}
              <span className="sr-only">{getTranslation("manage.common.notifications")}</span>
            </Button>

            {showNotifications && (
              <div className="fixed inset-x-3 top-[4.5rem] z-50 sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[min(calc(100vw-1.5rem),22rem)]">
                <Card className="manage-notification-panel overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-950/15">
                  <div className="manage-notification-panel-header border-b border-slate-200 bg-slate-950 px-3.5 py-3 text-white">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="text-sm font-semibold tracking-tight">
                            {getTranslation('manage.notifications.title')}
                          </h2>
                          {unreadCount > 0 ? (
                            <Badge className="h-5 rounded-full bg-white px-1.5 text-[10px] text-slate-950 hover:bg-white">
                              {unreadLabel}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-[11px] text-white/60">
                          {unreadCount > 0
                            ? getTranslation('manage.notifications.unreadSummary', { count: String(unreadCount) })
                            : getTranslation('manage.notifications.noNotifications')}
                        </p>
                      </div>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-7 w-7 rounded-lg text-white/70 hover:bg-white/10 hover:text-white"
                        onClick={() => setShowNotifications(false)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    <ManagePushNotificationSwitch variant="header" className="mt-3" />
                  </div>
                  <CardContent className="p-0">
                    <div className="manage-notification-panel-toolbar flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-1.5">
                      <span className="text-[11px] font-medium text-slate-500">
                        {notifications.length} {getTranslation('manage.notifications.total')}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={markAllAsRead}
                        disabled={unreadCount === 0}
                        className="h-6 rounded-md px-1.5 text-[11px] text-slate-600 hover:bg-white hover:text-slate-950 disabled:opacity-40"
                      >
                        <CheckCheck className="mr-1.5 h-3.5 w-3.5" />
                        {getTranslation('manage.notifications.markAllRead')}
                      </Button>
                    </div>
                    <div className="manage-notification-panel-list max-h-[calc(100vh-10rem)] overflow-y-auto bg-white sm:max-h-[20rem]">
                      {notifications.length === 0 ? (
                        <div className="px-5 py-7 text-center">
                          <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                            <Bell className="h-4 w-4" />
                          </div>
                            <p className="mt-2 text-xs font-medium text-slate-700">
                            {getTranslation('manage.notifications.noNotifications')}
                          </p>
                        </div>
                      ) : (
                        notifications.map((notification) => (
                          <div
                            key={notification.id}
                            className={cn(
                              "manage-notification-item group border-b border-slate-100 p-2.5 transition-colors last:border-b-0",
                              notification.read
                                ? "bg-white hover:bg-slate-50"
                                : "bg-[linear-gradient(90deg,rgba(14,165,233,0.12),rgba(255,255,255,0))] hover:bg-sky-50/70"
                            )}
                            onClick={() => {
                              markAsRead(notification.id)
                              setShowNotifications(false)
                              goToReservation(notification.reservation_id)
                            }}
                            role="button"
                            tabIndex={0}
                          >
                            <div className="flex items-start gap-2.5">
                              <div className={cn(
                                "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border",
                                notification.read
                                  ? "border-slate-200 bg-slate-50 text-slate-500"
                                  : "border-sky-200 bg-sky-100 text-sky-700"
                              )}>
                                <CalendarDays className="h-3.5 w-3.5" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <p className="truncate text-xs font-semibold text-slate-950">
                                        {getNotificationTitle(notification.event_type)}
                                      </p>
                                      {!notification.read ? (
                                        <span className="h-2 w-2 shrink-0 rounded-full bg-sky-500 shadow-[0_0_0_4px_rgba(14,165,233,0.12)]" />
                                      ) : null}
                                    </div>
                                    <p className="mt-0.5 truncate text-[11px] font-medium text-slate-600">
                                      {formatNotificationBody(notification)}
                                    </p>
                                  </div>
                                  <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-500">
                                    {formatCreatedTime(notification.created_at)}
                                  </span>
                                </div>
                                <div className="mt-1.5 flex flex-wrap gap-1 text-[10px] text-slate-600">
                                  <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5">
                                    <Users className="h-3 w-3" />
                                    {notification.party_size}
                                  </span>
                                  <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5">
                                    <Clock className="h-3 w-3" />
                                    {notification.reservation_time.slice(0, 5)}
                                  </span>
                                  <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5">
                                    <MapPin className="h-3 w-3" />
                                    {formatShortReservationDate(notification.reservation_date)}
                                  </span>
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 shrink-0 rounded-lg text-slate-400 opacity-100 hover:bg-rose-50 hover:text-rose-600 sm:opacity-0 sm:group-hover:opacity-100"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  dismissNotification(notification.id)
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Popup Notifications */}
      {popupNotifications.length > 0 && (
        <div
          className="fixed inset-x-3 top-[4.25rem] z-[9999] flex max-h-[calc(100dvh-5.25rem)] flex-col gap-2 overflow-y-auto pb-1 sm:inset-x-auto sm:right-4 sm:top-4 sm:w-[min(calc(100vw-2rem),20rem)]"
          aria-label={getTranslation("manage.notifications.title")}
          aria-live="polite"
        >
          {visiblePopupNotifications.map((popup, popupIndex) => (
            <div
              key={`${popup.id}-${popupIndex === popupEntryIndex ? popupAdvanceKey : popupIndex === 0 ? "front" : "queued"}`}
              className={cn(
                "relative w-full shrink-0 touch-pan-y will-change-transform",
                popupExitDirections[popup.id]
                  ? "pointer-events-none"
                  : popupIndex === popupEntryIndex && popupEntryMode === "up"
                    ? "animate-in slide-in-from-bottom-4 fade-in-0 duration-200"
                    : "animate-in slide-in-from-right-full fade-in-0 duration-300"
              )}
              style={{
                transform: `translate3d(${isClearingPopups ? 420 : popupDragOffsets[popup.id] ?? 0}px, 0, 0)`,
                opacity: isClearingPopups || popupExitDirections[popup.id] ? 0 : 1 - Math.min(Math.abs(popupDragOffsets[popup.id] ?? 0) / 240, 0.45),
                transition: isClearingPopups || popupExitDirections[popup.id] || popupDragStartRef.current[popup.id] === undefined ? "transform 220ms ease-out, opacity 220ms ease-out" : "none",
              }}
              onPointerDown={(event) => handlePopupPointerDown(popup.id, event)}
              onPointerMove={(event) => handlePopupPointerMove(popup.id, event)}
              onPointerUp={() => handlePopupPointerEnd(popup.id)}
              onPointerCancel={() => handlePopupPointerEnd(popup.id)}
            >
              <Card className="overflow-hidden rounded-2xl border border-slate-300/90 bg-white shadow-[0_20px_52px_rgba(15,23,42,0.2)] ring-1 ring-slate-950/5 transition-[border-color,box-shadow,background-color] hover:border-sky-300 hover:shadow-[0_22px_56px_rgba(15,23,42,0.24)] dark:border-white/20 dark:bg-[#1a1f2a] dark:ring-white/10">
                <div className="relative">
                  <button
                    type="button"
                    className="block w-full px-3.5 py-3 pr-12 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500"
                    onClick={() => openPopupReservation(popup)}
                    aria-label={`${getNotificationTitle(popup.event_type)}: ${formatPopupSummary(popup)}`}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-100 dark:bg-sky-400/10 dark:text-sky-200 dark:ring-sky-400/20">
                        <CalendarDays className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <Bell className="h-3 w-3 shrink-0 text-sky-600 dark:text-sky-300" />
                            <p className="truncate text-[11px] font-bold uppercase tracking-[0.12em] text-slate-700 dark:text-slate-200">
                              {getNotificationTitle(popup.event_type)}
                            </p>
                          </div>
                          <span className="shrink-0 text-[10px] font-medium text-slate-400 dark:text-slate-500">
                            {formatCreatedTime(popup.created_at)}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs font-semibold text-slate-950 dark:text-white">
                          {formatPopupSummary(popup)}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] font-medium text-slate-500 dark:text-slate-400">
                          <span className="inline-flex items-center gap-1">
                            <Users className="h-3 w-3 text-slate-400 dark:text-slate-500" />
                            {popup.party_size} Pax
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3 text-slate-400 dark:text-slate-500" />
                            {popup.reservation_time.slice(0, 5)}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3 w-3 text-slate-400 dark:text-slate-500" />
                            {formatShortReservationDate(popup.reservation_date)}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center gap-1 text-[10px] font-semibold text-sky-700 dark:text-sky-300">
                          {getTranslation("manage.notifications.viewDetails")}
                          <ArrowUpRight className="h-3 w-3" />
                        </div>
                      </div>
                    </div>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => markPopupAsReadAndClose(popup.id)}
                    aria-label={getTranslation("manage.notifications.dismiss")}
                    title={getTranslation("manage.notifications.dismiss")}
                    className="absolute right-2 top-2 h-7 w-7 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-white/10 dark:hover:text-slate-200"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </Card>
            </div>
          ))}
          {(hiddenPopupCount > 0 || popupNotifications.length > 1) && (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-300/90 bg-white px-2 py-1.5 shadow-[0_16px_36px_rgba(15,23,42,0.16)] ring-1 ring-slate-950/5 dark:border-white/20 dark:bg-[#1a1f2a] dark:ring-white/10">
              {hiddenPopupCount > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={openNotificationCenterFromPopups}
                  className="h-7 min-w-0 justify-start rounded-lg px-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
                >
                  <span className="truncate">
                    {getTranslation("manage.notifications.moreNotifications", { count: hiddenPopupCount })}
                  </span>
                </Button>
              ) : (
                <span className="px-2 text-[10px] font-medium text-slate-400 dark:text-slate-500">
                  {popupNotifications.length} {getTranslation("manage.notifications.total")}
                </span>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={markAllPopupNotificationsAsRead}
                loading={isClearingPopups}
                className="h-7 shrink-0 rounded-lg border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-600 shadow-none hover:bg-slate-50 hover:text-slate-950 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10 dark:hover:text-white"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                {getTranslation("manage.notifications.markAllRead")}
              </Button>
            </div>
          )}
        </div>
      )}
      </header>
    </>
  )
}
