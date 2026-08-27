"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import {
  Calendar,
  CalendarClock,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  UtensilsCrossed,
  Users,
  XCircle,
} from "lucide-react"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar as CalendarComponent } from "@/components/ui/calendar"
import { OrbLoader, LoadingOverlay } from "@/components/ui/orb-loader"
import { ReservationList, type ReservationMutationChange } from "@/components/manage/reservation-list"
import { ReservationForm } from "@/components/manage/reservation-form"
import { useLanguage } from "@/context/language-context"
import { useManageContext } from "@/context/manage-context"
import {
  getDashboardData,
  getDashboardReservationById,
  getDashboardStats,
  type DashboardSnapshot,
  type DashboardStats,
} from "./dashboard-actions"
import type { Database } from "@/types/supabase"
import {
  readManageOfflineCache,
  writeManageOfflineCache,
  type ManageCachedReservation,
} from "@/lib/manage-offline-cache"

type ReservationRecord = Database["public"]["Tables"]["reservations"]["Row"] & {
  restaurants?: { id: string; name: string } | null
  reservation_areas?: { id: string; name: string } | null
  booked_by_email?: string | null
  booked_by_label?: string | null
  booked_by_name?: string | null
}

const DASHBOARD_EVENING_FILTER_STORAGE_KEY = "felix:dashboard:evening-only"

type RestaurantOption = {
  id: string
  name: string
  meal_only_reservations?: boolean
}

type StatusFilter = "all" | "pending" | "confirmed" | "cancelled"
type MetricFilter = "all" | "kuver" | "meal" | "deck" | "terrace"
type OperationFilter = "latest" | "date"

const EMPTY_STATS: DashboardStats = {
  total: 0,
  pending: 0,
  confirmed: 0,
  cancelled: 0,
  percentChange: 0,
  totalKuver: 0,
  totalMealReservations: 0,
  deckKuvers: 0,
  terraceKuvers: 0,
}

const STATS_FIELDS: Array<keyof ReservationRecord> = [
  "status",
  "party_size",
  "reservation_date",
  "restaurant_id",
  "reservation_area_id",
  "reservation_type",
]

function dedupeReservations(reservations: ReservationRecord[]) {
  return Array.from(new Map(reservations.map((reservation) => [reservation.id, reservation])).values())
}

function normalizeRestaurantFilter(restaurantId?: string) {
  // Keep an explicit "all" value so the server does not fall back to a
  // stale restaurant-selection cookie from an older management session.
  return restaurantId && restaurantId !== "all" ? restaurantId : "all"
}

function getLocalDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function getDateWithOffset(offset: number) {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() + offset)
  return date
}

function getCompactDateLabel(date: Date, locale?: string) {
  return date.toLocaleDateString(locale || "en-US", {
    month: "short",
    day: "numeric",
  })
}

function getDayFilterLabel(date: Date, offset: number, locale: string | undefined, todayLabel: string, tomorrowLabel: string) {
  const dayNumber = date.getDate()
  if (offset === 0) return `${todayLabel} ${dayNumber}`
  if (offset === 1) return `${tomorrowLabel} ${dayNumber}`

  const weekday = date.toLocaleDateString(locale || "en-US", { weekday: "short" })
  return `${weekday} ${dayNumber}`
}

function isCreatedToday(reservation: ReservationRecord) {
  return getLocalDateKey(new Date(reservation.created_at)) === getLocalDateKey()
}

function isUpcomingReservation(reservation: ReservationRecord) {
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const next30Days = new Date(tomorrow)
  next30Days.setDate(next30Days.getDate() + 29)

  const tomorrowKey = getLocalDateKey(tomorrow)
  const next30DaysKey = getLocalDateKey(next30Days)
  return reservation.reservation_date >= tomorrowKey && reservation.reservation_date <= next30DaysKey
}

function sortByCreatedDesc(a: ReservationRecord, b: ReservationRecord) {
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
}

function sortByReservationDateTimeAsc(a: ReservationRecord, b: ReservationRecord) {
  const dateCompare = a.reservation_date.localeCompare(b.reservation_date)
  if (dateCompare !== 0) return dateCompare
  return a.reservation_time.localeCompare(b.reservation_time)
}

function calculateStatsFromReservations(reservations: ReservationRecord[]): DashboardStats {
  const stats = { ...EMPTY_STATS }

  for (const reservation of reservations) {
    const status = reservation.status || "pending"
    const partySize = Number(reservation.party_size || 0)
    const areaName = getReservationAreaName(reservation)

    stats.total += 1
    if (status === "pending") stats.pending += 1
    if (status === "confirmed") {
      stats.confirmed += 1
      stats.totalKuver += partySize
      if (areaName.includes("deck")) stats.deckKuvers += partySize
      if (areaName.includes("terrace")) stats.terraceKuvers += partySize
    }
    if (status === "cancelled") stats.cancelled += 1
    if (reservation.reservation_type === "meal") stats.totalMealReservations += 1
  }

  return stats
}

function buildOfflineDashboardSnapshot(
  reservations: ReservationRecord[],
  restaurantId: string,
  selectedDateKey: string,
  operationFilter: OperationFilter
): DashboardSnapshot {
  const scopedReservations = restaurantId && restaurantId !== "all"
    ? reservations.filter((reservation) => reservation.restaurant_id === restaurantId)
    : reservations
  const todayKey = getLocalDateKey()
  const last24Hours = new Date()
  last24Hours.setHours(last24Hours.getHours() - 24)

  const pendingReservations = scopedReservations
    .filter((reservation) => reservation.status === "pending")
    .sort(sortByReservationDateTimeAsc)
  const newReservations = scopedReservations
    .filter((reservation) => new Date(reservation.created_at) >= last24Hours)
    .sort(sortByCreatedDesc)
  const newTodayReservations = scopedReservations.filter(isCreatedToday).sort(sortByCreatedDesc)
  const todayReservations = scopedReservations
    .filter((reservation) => reservation.reservation_date === todayKey)
    .sort(sortByReservationDateTimeAsc)
  const upcomingReservations = scopedReservations
    .filter((reservation) => reservation.reservation_date > todayKey)
    .sort(sortByReservationDateTimeAsc)
  const selectedDateReservations = scopedReservations
    .filter((reservation) => reservation.reservation_date === selectedDateKey)
    .sort(sortByReservationDateTimeAsc)
  const statsReservations = operationFilter === "latest"
    ? scopedReservations.filter((reservation) => new Date(reservation.created_at) >= last24Hours)
    : selectedDateReservations

  return {
    stats: {
      ...calculateStatsFromReservations(statsReservations),
      pending: pendingReservations.length,
    },
    pendingReservations,
    newReservations,
    newTodayReservations,
    todayReservations,
    upcomingReservations,
    selectedDateReservations,
  }
}

function getSnapshotReservations(snapshot: DashboardSnapshot) {
  return dedupeReservations([
    ...(snapshot.pendingReservations as ReservationRecord[]),
    ...(snapshot.newReservations as ReservationRecord[]),
    ...(snapshot.newTodayReservations as ReservationRecord[]),
    ...(snapshot.todayReservations as ReservationRecord[]),
    ...(snapshot.upcomingReservations as ReservationRecord[]),
    ...(snapshot.selectedDateReservations as ReservationRecord[]),
  ])
}

function removeReservation(list: ReservationRecord[], reservationId: string) {
  return list.filter((reservation) => reservation.id !== reservationId)
}

function upsertReservation(
  list: ReservationRecord[],
  reservation: ReservationRecord,
  sortFn: (a: ReservationRecord, b: ReservationRecord) => number,
  limit?: number
) {
  const next = [reservation, ...list.filter((item) => item.id !== reservation.id)].sort(sortFn)
  return typeof limit === "number" ? next.slice(0, limit) : next
}

function statsChanged(previous?: ReservationRecord | null, next?: ReservationRecord | null) {
  if (!previous || !next) {
    return true
  }

  return STATS_FIELDS.some((field) => previous[field] !== next[field])
}

function getReservationAreaName(reservation: ReservationRecord) {
  return reservation.reservation_areas?.name?.toLowerCase() ?? ""
}

function matchesMetricFilter(reservation: ReservationRecord, metricFilter: MetricFilter) {
  if (metricFilter === "all") {
    return true
  }

  if (metricFilter === "meal") {
    return reservation.reservation_type === "meal"
  }

  if (metricFilter === "kuver") {
    return reservation.status === "confirmed"
  }

  const areaName = getReservationAreaName(reservation)
  if (metricFilter === "deck") {
    return reservation.status === "confirmed" && areaName.includes("deck")
  }

  if (metricFilter === "terrace") {
    return reservation.status === "confirmed" && areaName.includes("terrace")
  }

  return true
}

export default function ManageDashboard() {
  const { getTranslation } = useLanguage()
  const { role, isSuperAdmin, loading: roleLoading, restaurants: contextRestaurants } = useManageContext()
  const router = useRouter()
  const supabase = getSupabaseBrowserClient()
  const canViewAllRestaurants = isSuperAdmin || role === "admin" || role === "manager"
  const isSingleRestaurantRole = role === "staff" || role === "readonly"

  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isStatsLoading, setIsStatsLoading] = useState(false)
  const [dashboardError, setDashboardError] = useState<string | null>(null)
  const [offlineMode, setOfflineMode] = useState(false)
  const [offlineSyncedAt, setOfflineSyncedAt] = useState<string | null>(null)
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS)
  const [pendingReservations, setPendingReservations] = useState<ReservationRecord[]>([])
  const [newReservations, setNewReservations] = useState<ReservationRecord[]>([])
  const [newTodayReservations, setNewTodayReservations] = useState<ReservationRecord[]>([])
  const [todayReservations, setTodayReservations] = useState<ReservationRecord[]>([])
  const [upcomingReservations, setUpcomingReservations] = useState<ReservationRecord[]>([])
  const [selectedDateReservations, setSelectedDateReservations] = useState<ReservationRecord[]>([])
  const [restaurants, setRestaurants] = useState<RestaurantOption[]>([])
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [metricFilter, setMetricFilter] = useState<MetricFilter>("all")
  const [selectedRestaurant, setSelectedRestaurant] = useState("all")
  const [selectedDate, setSelectedDate] = useState<Date>(() => getDateWithOffset(0))
  const [operationFilter, setOperationFilter] = useState<OperationFilter>("date")
  const [datePopoverOpen, setDatePopoverOpen] = useState(false)
  const [cardsExpanded, setCardsExpanded] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [eveningOnly, setEveningOnly] = useState(true)
  const [hasLoadedEveningPreference, setHasLoadedEveningPreference] = useState(false)

  useEffect(() => {
    setEveningOnly(window.localStorage.getItem(DASHBOARD_EVENING_FILTER_STORAGE_KEY) !== "0")
    setHasLoadedEveningPreference(true)
  }, [])

  useEffect(() => {
    if (!hasLoadedEveningPreference) return
    window.localStorage.setItem(DASHBOARD_EVENING_FILTER_STORAGE_KEY, eveningOnly ? "1" : "0")
  }, [eveningOnly, hasLoadedEveningPreference])

  const hasLoadedInitialDataRef = useRef(false)
  const hasStartedInitialLoadRef = useRef(false)
  const lastLoadedDashboardFiltersRef = useRef<{
    restaurantId: string
    dateKey: string
    operationFilter: OperationFilter
  } | null>(null)
  const dashboardRequestIdRef = useRef(0)
  const statsRequestIdRef = useRef(0)
  const ignoredRealtimeIdsRef = useRef<Set<string>>(new Set())
  const statsRefreshTimerRef = useRef<number | null>(null)
  const offlineModeRef = useRef(false)
  const onlineRecoveryInFlightRef = useRef(false)
  const hasNormalizedDefaultRestaurantRef = useRef(false)
  const dashboardFiltersRef = useRef<{
    restaurantId: string
    dateKey: string
    operationFilter: OperationFilter
  }>({
    restaurantId: "all",
    dateKey: getLocalDateKey(),
    operationFilter: "date",
  })

  const selectedDateKey = useMemo(
    () => format(selectedDate, "yyyy-MM-dd"),
    [selectedDate]
  )

  const dayFilterOptions = useMemo(() => (
    [0, 1, 2, 3].map((offset) => {
      const date = getDateWithOffset(offset)
      return {
        date,
        dateKey: getLocalDateKey(date),
        label: getDayFilterLabel(
          date,
          offset,
          getTranslation("common.locale"),
          getTranslation("manage.reservations.filters.dateToday"),
          getTranslation("manage.reservations.filters.dateTomorrow"),
        ),
      }
    })
  ), [getTranslation])

  const operationFilterLabel = useMemo(() => {
    if (operationFilter === "latest") {
      return getTranslation("manage.dashboard.latestReservations")
    }

    const preset = dayFilterOptions.find((option) => option.dateKey === selectedDateKey)
    return preset?.label ?? getCompactDateLabel(selectedDate, getTranslation("common.locale"))
  }, [dayFilterOptions, getTranslation, operationFilter, selectedDate, selectedDateKey])

  const setDashboardSnapshot = useCallback((snapshot: DashboardSnapshot) => {
    const nextPendingReservations = snapshot.pendingReservations as ReservationRecord[]
    setStats({
      ...snapshot.stats,
      pending: nextPendingReservations.length,
    })
    setPendingReservations(nextPendingReservations)
    setNewReservations(snapshot.newReservations as ReservationRecord[])
    setNewTodayReservations(snapshot.newTodayReservations as ReservationRecord[])
    setTodayReservations(snapshot.todayReservations as ReservationRecord[])
    setUpcomingReservations(snapshot.upcomingReservations as ReservationRecord[])
    setSelectedDateReservations(snapshot.selectedDateReservations as ReservationRecord[])
  }, [])

  const writeDashboardOfflineCache = useCallback((snapshot: DashboardSnapshot, restaurantOptions: RestaurantOption[]) => {
    const cache = writeManageOfflineCache({
      reservations: getSnapshotReservations(snapshot) as ManageCachedReservation[],
      restaurants: restaurantOptions,
    })
    if (cache) {
      setOfflineSyncedAt(cache.syncedAt)
    }
  }, [])

  const flushCurrentDashboardToOfflineCache = useCallback(() => {
    const reservations = dedupeReservations([
      ...pendingReservations,
      ...newReservations,
      ...newTodayReservations,
      ...todayReservations,
      ...upcomingReservations,
      ...selectedDateReservations,
    ])

    if (reservations.length === 0 && restaurants.length === 0) {
      return
    }

    const cache = writeManageOfflineCache({
      reservations: reservations as ManageCachedReservation[],
      restaurants,
    })
    if (cache) {
      setOfflineSyncedAt(cache.syncedAt)
    }
  }, [
    newReservations,
    newTodayReservations,
    pendingReservations,
    restaurants,
    selectedDateReservations,
    todayReservations,
    upcomingReservations,
  ])

  const loadDashboardFromOfflineCache = useCallback((
    restaurantId: string,
    dateKey: string,
    nextOperationFilter: OperationFilter
  ) => {
    const cache = readManageOfflineCache()
    const effectiveRestaurantId = restaurantId || "all"
    const effectiveOperationFilter = nextOperationFilter

    offlineModeRef.current = true
    setOfflineMode(true)
    setOfflineSyncedAt(cache?.syncedAt || null)
    setDashboardError(null)
    setShowCreateForm(false)
    lastLoadedDashboardFiltersRef.current = {
      restaurantId: effectiveRestaurantId,
      dateKey,
      operationFilter: effectiveOperationFilter,
    }

    if (cache?.restaurants.length) {
      setRestaurants(cache.restaurants)
    }

    setDashboardSnapshot(
      buildOfflineDashboardSnapshot(
        ((cache?.reservations || []) as ManageCachedReservation[]) as ReservationRecord[],
        effectiveRestaurantId,
        dateKey,
        effectiveOperationFilter
      )
    )
  }, [setDashboardSnapshot])

  useEffect(() => {
    dashboardFiltersRef.current = {
      restaurantId: selectedRestaurant,
      dateKey: selectedDateKey,
      operationFilter,
    }
  }, [operationFilter, selectedRestaurant, selectedDateKey])

  useEffect(() => {
    offlineModeRef.current = offlineMode
  }, [offlineMode])

  useEffect(() => {
    if (hasNormalizedDefaultRestaurantRef.current || isSingleRestaurantRole || selectedRestaurant === "all") {
      return
    }

    hasNormalizedDefaultRestaurantRef.current = true
    setSelectedRestaurant("all")
  }, [isSingleRestaurantRole, selectedRestaurant])

  const refreshStats = useCallback(async (
    restaurantId?: string,
    dateKey?: string,
    nextOperationFilter?: OperationFilter
  ) => {
    const filters = dashboardFiltersRef.current
    const targetRestaurantId = restaurantId ?? filters.restaurantId
    const targetDateKey = dateKey ?? filters.dateKey
    const targetOperationFilter = nextOperationFilter ?? filters.operationFilter
    const requestId = ++statsRequestIdRef.current

    if (offlineMode) {
      const cache = readManageOfflineCache()
      const snapshot = buildOfflineDashboardSnapshot(
        ((cache?.reservations || []) as ManageCachedReservation[]) as ReservationRecord[],
        targetRestaurantId,
        targetDateKey,
        targetOperationFilter
      )
      setStats(snapshot.stats)
      return
    }

    setIsStatsLoading(true)

    try {
      const result = await getDashboardStats(
        normalizeRestaurantFilter(targetRestaurantId),
        targetOperationFilter === "latest" ? undefined : targetDateKey,
        targetOperationFilter === "latest" ? "latest" : "daily"
      )
      if (statsRequestIdRef.current !== requestId) {
        return
      }

      if (result?.success && result.stats) {
        setStats(result.stats)
      }
    } catch (error) {
      console.error("Error refreshing dashboard stats:", error)
    } finally {
      if (statsRequestIdRef.current === requestId) {
        setIsStatsLoading(false)
      }
    }
  }, [offlineMode])

  const scheduleStatsRefresh = useCallback(() => {
    if (statsRefreshTimerRef.current) {
      window.clearTimeout(statsRefreshTimerRef.current)
    }

    statsRefreshTimerRef.current = window.setTimeout(() => {
      void refreshStats()
    }, 150)
  }, [refreshStats])

  const fetchDashboardSnapshot = useCallback(async ({
    restaurantId,
    dateKey,
    operationFilter: nextOperationFilter,
    fullLoader = false,
    silent = false,
  }: {
    restaurantId?: string
    dateKey?: string
    operationFilter?: OperationFilter
    fullLoader?: boolean
    silent?: boolean
  } = {}) => {
    const filters = dashboardFiltersRef.current
    const targetRestaurantId = restaurantId ?? filters.restaurantId
    const targetDateKey = dateKey ?? filters.dateKey
    const targetOperationFilter = nextOperationFilter ?? filters.operationFilter
    const requestId = ++dashboardRequestIdRef.current

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      loadDashboardFromOfflineCache(targetRestaurantId || "all", targetDateKey, targetOperationFilter)
      hasLoadedInitialDataRef.current = true
      setIsLoading(false)
      setIsRefreshing(false)
      return
    }

    if (fullLoader) {
      setIsLoading(true)
    } else if (!silent) {
      setIsRefreshing(true)
    }

    try {
      setDashboardError(null)
      const result = await getDashboardData(
        normalizeRestaurantFilter(targetRestaurantId),
        targetOperationFilter === "latest" ? undefined : targetDateKey,
        targetOperationFilter === "latest" ? "latest" : "daily"
      )
      if (dashboardRequestIdRef.current !== requestId) {
        return
      }

      if (result?.success && result.data) {
        onlineRecoveryInFlightRef.current = false
        setOfflineMode(false)
        setOfflineSyncedAt(null)
        setDashboardSnapshot(result.data)
        writeDashboardOfflineCache(result.data, restaurants)
        lastLoadedDashboardFiltersRef.current = {
          restaurantId: targetRestaurantId,
          dateKey: targetDateKey,
          operationFilter: targetOperationFilter,
        }
      } else {
        loadDashboardFromOfflineCache(targetRestaurantId, targetDateKey, targetOperationFilter)
      }
    } catch (error) {
      console.error("Error fetching dashboard data:", error)
      loadDashboardFromOfflineCache(targetRestaurantId, targetDateKey, targetOperationFilter)
    } finally {
      if (dashboardRequestIdRef.current === requestId) {
        setIsLoading(false)
        if (!silent) setIsRefreshing(false)
      }
    }
  }, [
    loadDashboardFromOfflineCache,
    restaurants,
    setDashboardSnapshot,
    writeDashboardOfflineCache,
  ])

  const ignoreNextRealtimeEvent = useCallback((reservationId: string) => {
    ignoredRealtimeIdsRef.current.add(reservationId)
    window.setTimeout(() => {
      ignoredRealtimeIdsRef.current.delete(reservationId)
    }, 2500)
  }, [])

  const matchesCurrentRestaurant = useCallback((reservation: ReservationRecord) => {
    return !selectedRestaurant || selectedRestaurant === "all" || reservation.restaurant_id === selectedRestaurant
  }, [selectedRestaurant])

  const applyReservationChange = useCallback((change: ReservationMutationChange) => {
    const reservation = change.reservation as ReservationRecord | null | undefined
    const reservationId = change.reservationId || reservation?.id || change.previousReservation?.id

    if (!reservationId) {
      void fetchDashboardSnapshot()
      return
    }

    if (change.type === "delete") {
      setPendingReservations((prev) => removeReservation(prev, reservationId))
      setNewReservations((prev) => removeReservation(prev, reservationId))
      setNewTodayReservations((prev) => removeReservation(prev, reservationId))
      setTodayReservations((prev) => removeReservation(prev, reservationId))
      setUpcomingReservations((prev) => removeReservation(prev, reservationId))
      setSelectedDateReservations((prev) => removeReservation(prev, reservationId))
      scheduleStatsRefresh()
      return
    }

    if (!reservation) {
      void fetchDashboardSnapshot()
      return
    }

    const visibleForRestaurant = matchesCurrentRestaurant(reservation)
    const todayKey = getLocalDateKey()
    const selectedKey = selectedDateKey

    setPendingReservations((prev) => (
      visibleForRestaurant && reservation.status === "pending"
        ? upsertReservation(prev, reservation, sortByReservationDateTimeAsc)
        : removeReservation(prev, reservation.id)
    ))
    setNewReservations((prev) => (
      visibleForRestaurant
        ? upsertReservation(prev, reservation, sortByCreatedDesc, 20)
        : removeReservation(prev, reservation.id)
    ))
    setNewTodayReservations((prev) => (
      visibleForRestaurant && isCreatedToday(reservation)
        ? upsertReservation(prev, reservation, sortByCreatedDesc)
        : removeReservation(prev, reservation.id)
    ))
    setTodayReservations((prev) => (
      visibleForRestaurant && reservation.reservation_date === todayKey
        ? upsertReservation(prev, reservation, sortByReservationDateTimeAsc)
        : removeReservation(prev, reservation.id)
    ))
    setUpcomingReservations((prev) => (
      visibleForRestaurant && isUpcomingReservation(reservation)
        ? upsertReservation(prev, reservation, sortByReservationDateTimeAsc)
        : removeReservation(prev, reservation.id)
    ))
    setSelectedDateReservations((prev) => (
      visibleForRestaurant && selectedKey && reservation.reservation_date === selectedKey
        ? upsertReservation(prev, reservation, sortByReservationDateTimeAsc)
        : removeReservation(prev, reservation.id)
    ))

    const shouldRefreshStats = change.statsDirty ?? statsChanged(
      change.previousReservation as ReservationRecord | null | undefined,
      reservation
    )
    if (shouldRefreshStats) {
      scheduleStatsRefresh()
    }
  }, [fetchDashboardSnapshot, matchesCurrentRestaurant, scheduleStatsRefresh, selectedDateKey])

  const handleReservationChange = useCallback((change: ReservationMutationChange) => {
    const reservationId = change.reservationId || change.reservation?.id || change.previousReservation?.id
    if (reservationId) {
      ignoreNextRealtimeEvent(reservationId)
    }

    applyReservationChange(change)
  }, [applyReservationChange, ignoreNextRealtimeEvent])

  useEffect(() => {
    if (roleLoading || hasStartedInitialLoadRef.current) {
      return
    }
    hasStartedInitialLoadRef.current = true

    let cancelled = false

    const loadInitialDashboard = async () => {
      setIsLoading(true)
      try {
        setDashboardError(null)
        const restaurantData = contextRestaurants
        const canUseAllRestaurants = !isSingleRestaurantRole
        const initialRestaurant = canUseAllRestaurants ? "all" : restaurantData[0]?.id || "all"

        if (cancelled) return

        setRestaurants(restaurantData)
        hasNormalizedDefaultRestaurantRef.current = true
        setSelectedRestaurant(initialRestaurant)

        const initialDateKey = getLocalDateKey()
        const cachedDashboard = readManageOfflineCache()
        if (cachedDashboard) {
          loadDashboardFromOfflineCache(initialRestaurant, initialDateKey, "date")
          offlineModeRef.current = false
          setOfflineMode(false)
          setIsLoading(false)
          hasLoadedInitialDataRef.current = true
          void fetchDashboardSnapshot({
            restaurantId: initialRestaurant,
            dateKey: initialDateKey,
            operationFilter: "date",
            silent: true,
          })
          return
        }

        const dashboardResult = await getDashboardData(normalizeRestaurantFilter(initialRestaurant), initialDateKey, "daily")
        if (cancelled) return

        if (dashboardResult?.success && dashboardResult.data) {
          onlineRecoveryInFlightRef.current = false
          setOfflineMode(false)
          setOfflineSyncedAt(null)
          setDashboardSnapshot(dashboardResult.data)
          writeDashboardOfflineCache(dashboardResult.data, restaurantData)
          lastLoadedDashboardFiltersRef.current = {
            restaurantId: initialRestaurant,
            dateKey: initialDateKey,
            operationFilter: "date",
          }
        } else {
          loadDashboardFromOfflineCache(initialRestaurant, initialDateKey, "date")
        }

        hasLoadedInitialDataRef.current = true
      } catch (error) {
        console.error("Error loading dashboard:", error)
        const filters = dashboardFiltersRef.current
        loadDashboardFromOfflineCache(filters.restaurantId || "all", filters.dateKey, filters.operationFilter)
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadInitialDashboard()

    return () => {
      cancelled = true
    }
  }, [
    roleLoading,
    role,
    isSingleRestaurantRole,
    contextRestaurants,
    setDashboardSnapshot,
    writeDashboardOfflineCache,
    loadDashboardFromOfflineCache,
    fetchDashboardSnapshot,
  ])

  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        router.replace("/login?logged_out=1")
      }
    })

    return () => subscription?.subscription?.unsubscribe?.()
  }, [router, supabase])

  useEffect(() => {
    if (!hasLoadedInitialDataRef.current) {
      return
    }

    const lastLoadedFilters = lastLoadedDashboardFiltersRef.current
    if (
      lastLoadedFilters &&
      lastLoadedFilters.restaurantId === selectedRestaurant &&
      lastLoadedFilters.dateKey === selectedDateKey &&
      lastLoadedFilters.operationFilter === operationFilter
    ) {
      return
    }

    void fetchDashboardSnapshot()
  }, [fetchDashboardSnapshot, operationFilter, selectedDateKey, selectedRestaurant])

  useEffect(() => {
    if (typeof window === "undefined") return

    const handleOffline = () => {
      if (offlineModeRef.current) {
        return
      }

      onlineRecoveryInFlightRef.current = false
      offlineModeRef.current = true
      flushCurrentDashboardToOfflineCache()
      const filters = dashboardFiltersRef.current
      loadDashboardFromOfflineCache(filters.restaurantId || "all", filters.dateKey, filters.operationFilter)
      hasLoadedInitialDataRef.current = true
      setIsLoading(false)
      setIsRefreshing(false)
      setIsStatsLoading(false)
    }

    const handleOnline = () => {
      onlineRecoveryInFlightRef.current = false
      offlineModeRef.current = false
      void fetchDashboardSnapshot({ fullLoader: false })
    }

    if (!navigator.onLine) {
      handleOffline()
    }

    window.addEventListener("offline", handleOffline)
    window.addEventListener("online", handleOnline)

    return () => {
      window.removeEventListener("offline", handleOffline)
      window.removeEventListener("online", handleOnline)
    }
  }, [fetchDashboardSnapshot, flushCurrentDashboardToOfflineCache, loadDashboardFromOfflineCache])

  useEffect(() => {
    if (!offlineMode) {
      onlineRecoveryInFlightRef.current = false
      return
    }

    if (typeof navigator === "undefined" || typeof window === "undefined") {
      return
    }

    const recover = () => {
      if (!navigator.onLine || onlineRecoveryInFlightRef.current) {
        return
      }

      onlineRecoveryInFlightRef.current = true
      void fetchDashboardSnapshot({ fullLoader: false }).finally(() => {
        onlineRecoveryInFlightRef.current = false
      })
    }

    const timeoutId = window.setTimeout(recover, 500)
    const intervalId = window.setInterval(recover, 5000)
    window.addEventListener("focus", recover)
    document.addEventListener("visibilitychange", recover)

    return () => {
      window.clearTimeout(timeoutId)
      window.clearInterval(intervalId)
      window.removeEventListener("focus", recover)
      document.removeEventListener("visibilitychange", recover)
    }
  }, [fetchDashboardSnapshot, offlineMode])

  useEffect(() => {
    if (offlineMode) {
      return
    }

    const channel = supabase
      .channel("dashboard-reservations")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "reservations",
        },
        async (payload: any) => {
          const reservationId = payload.new?.id || payload.old?.id
          if (!reservationId) {
            return
          }

          if (ignoredRealtimeIdsRef.current.has(reservationId)) {
            ignoredRealtimeIdsRef.current.delete(reservationId)
            return
          }

          if (payload.eventType === "DELETE") {
            applyReservationChange({
              type: "delete",
              reservationId,
              statsDirty: true,
            })
            return
          }

          const result = await getDashboardReservationById(reservationId, normalizeRestaurantFilter(selectedRestaurant))
          if (result?.success && result.data) {
            applyReservationChange({
              type: payload.eventType === "INSERT" ? "create" : "update",
              reservation: result.data as unknown as ReservationRecord,
              statsDirty: true,
            })
          } else if (payload.eventType === "UPDATE") {
            applyReservationChange({
              type: "delete",
              reservationId,
              statsDirty: true,
            })
          }
        }
      )
      .subscribe()

    // Realtime is the fast path, but replication or RLS authorization can
    // briefly drop an event without closing the websocket. Reconcile
    // silently so new reservations still reach the dashboard automatically.
    const reconciliationIntervalId = window.setInterval(() => {
      if (!navigator.onLine || document.visibilityState === "hidden") return
      void fetchDashboardSnapshot({ fullLoader: false, silent: true })
    }, 10000)

    return () => {
      supabase.removeChannel(channel)
      window.clearInterval(reconciliationIntervalId)
    }
  }, [applyReservationChange, fetchDashboardSnapshot, offlineMode, selectedRestaurant, supabase])

  useEffect(() => {
    return () => {
      if (statsRefreshTimerRef.current) {
        window.clearTimeout(statsRefreshTimerRef.current)
      }
    }
  }, [])

  const handleStatusFilter = useCallback((nextStatusFilter: StatusFilter) => {
    setStatusFilter(nextStatusFilter)
    setMetricFilter("all")
  }, [])

  const handleMetricFilter = useCallback((nextMetricFilter: MetricFilter) => {
    setMetricFilter((currentMetricFilter) => (currentMetricFilter === nextMetricFilter ? "all" : nextMetricFilter))
    setStatusFilter("all")
  }, [])

  const handleLatestFilter = useCallback(() => {
    setSelectedDate(getDateWithOffset(0))
    setOperationFilter("latest")
    setDatePopoverOpen(false)
  }, [])

  const handleDateFilter = useCallback((date: Date) => {
    setSelectedDate(date)
    setOperationFilter("date")
    setDatePopoverOpen(false)
  }, [])

  const activeFilterLabel = useMemo(() => {
    if (metricFilter !== "all") {
      return metricFilter === "kuver" ? getTranslation("manage.dashboard.totalKuver")
        : metricFilter === "meal" ? getTranslation("manage.dashboard.mealReservations")
          : metricFilter === "deck" ? getTranslation("manage.dashboard.deck")
            : getTranslation("manage.dashboard.terrace")
    }

    if (statusFilter !== "all") {
      return statusFilter === "pending" ? getTranslation("manage.dashboard.stats.pending")
        : statusFilter === "confirmed" ? getTranslation("manage.dashboard.stats.confirmed")
          : getTranslation("manage.dashboard.stats.cancelled")
    }

    return null
  }, [getTranslation, metricFilter, statusFilter])

  const filterReservations = useCallback((reservations: ReservationRecord[]) => {
    let filtered = reservations
    if (selectedRestaurant !== "all") {
      filtered = filtered.filter((reservation) => reservation.restaurant_id === selectedRestaurant)
    }
    if (statusFilter !== "all") {
      filtered = filtered.filter((reservation) => reservation.status === statusFilter)
    }
    if (metricFilter !== "all") {
      filtered = filtered.filter((reservation) => matchesMetricFilter(reservation, metricFilter))
    }
    if (eveningOnly) {
      filtered = filtered.filter((reservation) => reservation.reservation_time.slice(0, 5) >= "18:00")
    }
    return filtered
  }, [eveningOnly, metricFilter, selectedRestaurant, statusFilter])

  const filteredNewReservations = useMemo(
    () => filterReservations(newReservations),
    [filterReservations, newReservations]
  )
  const filteredNewTodayReservations = useMemo(
    () => filterReservations(newTodayReservations),
    [filterReservations, newTodayReservations]
  )
  const filteredPendingReservations = useMemo(
    () => pendingReservations.filter((reservation) => (
      selectedRestaurant === "all" || reservation.restaurant_id === selectedRestaurant
    )),
    [pendingReservations, selectedRestaurant]
  )
  const filteredSelectedDateReservations = useMemo(
    () => filterReservations(selectedDateReservations),
    [filterReservations, selectedDateReservations]
  )
  const operationReservations = statusFilter === "pending"
    ? filteredPendingReservations
    : operationFilter === "latest"
      ? filteredNewReservations
      : filteredSelectedDateReservations
  const operationCount = operationReservations.length
  const operationTitle = statusFilter === "pending"
    ? getTranslation("manage.dashboard.pendingReservations")
    : operationFilter === "latest"
      ? getTranslation("manage.dashboard.latestReservations")
      : getTranslation("manage.dashboard.reservationsFor", { filter: operationFilterLabel })
  const operationDescription = statusFilter === "pending"
    ? getTranslation("manage.dashboard.pendingShown", { count: String(operationCount) })
    : operationFilter === "latest"
      ? getTranslation("manage.dashboard.latestShown", { today: String(filteredNewTodayReservations.length), latest: String(filteredNewReservations.length) })
      : getTranslation("manage.dashboard.filterShown", { count: String(operationCount), filter: operationFilterLabel })
  const pendingCount = useMemo(
    () => pendingReservations.filter((reservation) => (
      selectedRestaurant === "all" || reservation.restaurant_id === selectedRestaurant
    )).length,
    [pendingReservations, selectedRestaurant]
  )
  const displayedStats = useMemo(() => {
    if (!eveningOnly) return stats
    const source = operationFilter === "latest" ? newReservations : selectedDateReservations
    return {
      ...calculateStatsFromReservations(source.filter((reservation) => reservation.reservation_time.slice(0, 5) >= "18:00")),
      pending: pendingCount,
    }
  }, [eveningOnly, newReservations, operationFilter, pendingCount, selectedDateReservations, stats])
  const statsDateLabel = operationFilter === "latest" ? getTranslation("manage.dashboard.last24Hours") : operationFilterLabel
  const totalStatsLabel = operationFilter === "latest"
    ? getTranslation("manage.dashboard.latest")
    : statsDateLabel
  const defaultFormRestaurantId = normalizeRestaurantFilter(selectedRestaurant)
  const canSelectAllRestaurants = !isSingleRestaurantRole || canViewAllRestaurants || offlineMode || restaurants.length > 1 || selectedRestaurant === "all"

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <div className="text-center">
          <OrbLoader label={getTranslation("manage.common.loadingDashboard")} state="searching" />
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-[1400px] mx-auto">
      <div className="flex flex-col space-y-4 sm:flex-row sm:items-center sm:justify-between sm:space-y-0 mb-6">
        <div className="flex items-center space-x-3">
          <h1 className="text-xl md:text-2xl font-semibold">{getTranslation("manage.dashboard.title")}</h1>
          {!offlineMode ? (
            <Button
              onClick={() => setShowCreateForm(true)}
              className="bg-black hover:bg-gray-800 text-white text-xs px-2 py-1 h-7"
              size="sm"
            >
              + {getTranslation("manage.reservations.list.addReservation")}
            </Button>
          ) : null}
        </div>

        <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:min-w-[420px] sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="w-full min-w-0 justify-between px-3 text-sm font-normal"
                aria-label={getTranslation("common.operationFilter")}
              >
                <span className="truncate">{operationFilterLabel}</span>
                <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-60" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[min(92vw,340px)] p-2" align="end">
              <div className="flex flex-col gap-1">
                <Button
                  type="button"
                  variant={operationFilter === "latest" ? "default" : "ghost"}
                  className="h-9 justify-start text-sm"
                  onClick={handleLatestFilter}
                >
                  Latest
                </Button>
                {dayFilterOptions.map((option) => (
                  <Button
                    key={option.dateKey}
                    type="button"
                    variant={operationFilter === "date" && selectedDateKey === option.dateKey ? "default" : "ghost"}
                    className="h-9 justify-start text-sm"
                    onClick={() => handleDateFilter(option.date)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
              <div className="mt-2 border-t pt-2">
                <div className="mb-2 flex items-center gap-2 px-2 text-xs font-medium text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" />
                  Pick date
                </div>
                <CalendarComponent
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => {
                    if (date) {
                      handleDateFilter(date)
                    }
                  }}
                  initialFocus
                />
              </div>
            </PopoverContent>
          </Popover>

          <div className="min-w-0">
            <Select value={selectedRestaurant} onValueChange={setSelectedRestaurant}>
              <SelectTrigger className="text-sm">
                <SelectValue placeholder={getTranslation("manage.dashboard.filter.allRestaurants")} />
              </SelectTrigger>
              <SelectContent>
                {canSelectAllRestaurants && (
                  <SelectItem value="all">{getTranslation("manage.dashboard.filter.allRestaurants")}</SelectItem>
                )}
                {restaurants.map((restaurant) => (
                  <SelectItem key={restaurant.id} value={restaurant.id}>
                    {restaurant.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {offlineMode ? (
        <Card className="mb-4 border-amber-200 bg-amber-50">
          <CardContent className="p-3 text-sm text-amber-900">
            <div className="font-medium">{getTranslation("manage.offline.title")}</div>
            <div>
              {offlineSyncedAt
                ? getTranslation("manage.offline.description", {
                    syncedAt: new Date(offlineSyncedAt).toLocaleString(getTranslation("common.locale") || "en-US"),
                  })
                : getTranslation("manage.offline.noCache")}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="mb-6">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-2 transition-all duration-300">
          <Card
            className={`cursor-pointer transition-all hover:shadow-md ${statusFilter === "all" && metricFilter === "all" ? "ring-2 ring-blue-500" : ""}`}
            onClick={() => handleStatusFilter("all")}
            role="button"
            aria-pressed={statusFilter === "all" && metricFilter === "all"}
          >
            <CardContent className="p-2.5 md:p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs md:text-sm font-medium text-muted-foreground">
                    {totalStatsLabel}
                  </p>
                  <p className="text-lg md:text-xl font-bold">{displayedStats.total}</p>
                </div>
                <div className="rounded-full bg-blue-100 p-1.5 text-blue-600">
                  <CalendarClock className="h-3.5 w-3.5 md:h-4 md:w-4" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card
            className={`cursor-pointer transition-all hover:shadow-md ${metricFilter === "kuver" ? "ring-2 ring-purple-500" : ""}`}
            onClick={() => handleMetricFilter("kuver")}
            role="button"
            aria-pressed={metricFilter === "kuver"}
          >
            <CardContent className="p-2.5 md:p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs md:text-sm font-medium text-muted-foreground">{getTranslation("manage.dashboard.totalKuver")}</p>
                  <p className="text-lg md:text-xl font-bold">{displayedStats.totalKuver}</p>
                </div>
                <div className="rounded-full bg-purple-100 p-1.5 text-purple-600">
                  <Users className="h-3.5 w-3.5 md:h-4 md:w-4" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card
            className={`cursor-pointer transition-all hover:shadow-md ${statusFilter === "pending" ? "ring-2 ring-yellow-500" : ""}`}
            onClick={() => handleStatusFilter("pending")}
            role="button"
            aria-pressed={statusFilter === "pending"}
          >
            <CardContent className="p-2.5 md:p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs md:text-sm font-medium text-muted-foreground">
                    {getTranslation("manage.dashboard.stats.pending")}
                  </p>
                  <p className="text-lg md:text-xl font-bold">{pendingCount}</p>
                </div>
                <div className="rounded-full bg-yellow-100 p-1.5 text-yellow-600">
                  <Clock className="h-3.5 w-3.5 md:h-4 md:w-4" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card
            className={`cursor-pointer transition-all hover:shadow-md ${statusFilter === "cancelled" ? "ring-2 ring-red-500" : ""}`}
            onClick={() => handleStatusFilter("cancelled")}
            role="button"
            aria-pressed={statusFilter === "cancelled"}
          >
            <CardContent className="p-2.5 md:p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs md:text-sm font-medium text-muted-foreground">
                    {getTranslation("manage.dashboard.stats.cancelled")}
                  </p>
                  <p className="text-lg md:text-xl font-bold">{displayedStats.cancelled}</p>
                </div>
                <div className="rounded-full bg-red-100 p-1.5 text-red-600">
                  <XCircle className="h-3.5 w-3.5 md:h-4 md:w-4" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {cardsExpanded ? (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-2 md:gap-2 mt-2 transition-all duration-300">
            <Card
              className={`cursor-pointer transition-all hover:shadow-md ${statusFilter === "confirmed" ? "ring-2 ring-green-500" : ""}`}
              onClick={() => handleStatusFilter("confirmed")}
              role="button"
              aria-pressed={statusFilter === "confirmed"}
            >
              <CardContent className="p-2.5 md:p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs md:text-sm font-medium text-muted-foreground">
                      {getTranslation("manage.dashboard.stats.confirmed")}
                    </p>
                    <p className="text-lg md:text-xl font-bold">{displayedStats.confirmed}</p>
                  </div>
                  <div className="rounded-full bg-green-100 p-1.5 text-green-600">
                    <CheckCircle className="h-3.5 w-3.5 md:h-4 md:w-4" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card
              className={`cursor-pointer transition-all hover:shadow-md ${metricFilter === "meal" ? "ring-2 ring-orange-500" : ""}`}
              onClick={() => handleMetricFilter("meal")}
              role="button"
              aria-pressed={metricFilter === "meal"}
            >
              <CardContent className="p-2.5 md:p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs md:text-sm font-medium text-muted-foreground">{getTranslation("manage.dashboard.mealReservations")}</p>
                    <p className="text-lg md:text-xl font-bold">{displayedStats.totalMealReservations}</p>
                  </div>
                  <div className="rounded-full bg-orange-100 p-1.5 text-orange-600">
                    <UtensilsCrossed className="h-3.5 w-3.5 md:h-4 md:w-4" />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">{getTranslation("manage.dashboard.foodReservations")}</p>
              </CardContent>
            </Card>

          </div>
        ) : null}

        <div className="flex justify-center -mt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCardsExpanded((expanded) => !expanded)}
            className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {cardsExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {dashboardError ? (
        <Card className="mb-4 border-red-200 bg-red-50">
          <CardContent className="p-3 text-sm text-red-700">
            {dashboardError}
          </CardContent>
        </Card>
      ) : null}

      <div className="relative">
        {isStatsLoading || isRefreshing ? (
          <LoadingOverlay label={getTranslation("manage.common.loadingDashboard")} state="searching" size="md" />
        ) : null}

        <div className="flex flex-col gap-4">
          <div>
            <div className="mb-4">
              <div className="flex flex-col gap-1">
                <div>
                  <h3 className="text-lg font-semibold">{operationTitle}</h3>
                  <p className="text-sm text-muted-foreground">
                    {operationDescription}
                    {activeFilterLabel ? (
                      <span className="ml-2 text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full">
                        Filtered by: {activeFilterLabel}
                      </span>
                    ) : null}
                  </p>
                </div>
              </div>
            </div>
            {operationCount > 0 ? (
              <ReservationList
                reservations={operationReservations}
                onStatusChange={() => void fetchDashboardSnapshot()}
                onReservationChange={handleReservationChange}
                itemsPerPage={10}
                restaurants={restaurants}
                defaultRestaurantId={defaultFormRestaurantId}
                readOnly={offlineMode}
                eveningOnly={eveningOnly}
                onEveningOnlyChange={setEveningOnly}
              />
            ) : (
              <Card>
                <CardContent className="flex min-h-[180px] flex-col items-center justify-center gap-2 p-6 text-center">
                  <CalendarClock className="h-8 w-8 text-muted-foreground" />
                        <h4 className="text-sm font-medium">{getTranslation("manage.dashboard.noReservations")}</h4>
                  <p className="max-w-sm text-sm text-muted-foreground">
                    {offlineMode && !offlineSyncedAt
                      ? getTranslation("manage.offline.empty")
                      : statusFilter === "pending"
                      ? getTranslation("manage.dashboard.noPending")
                      : operationFilter === "latest"
                      ? getTranslation("manage.dashboard.noRecent")
                      : getTranslation("manage.dashboard.noMatch", { filter: operationFilterLabel })}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6">
        <Button onClick={() => void fetchDashboardSnapshot()} variant="outline" loading={isRefreshing}>
          {isRefreshing ? getTranslation("manage.common.loadingDashboard") : getTranslation("manage.common.refreshData")}
        </Button>
      </div>

      {showCreateForm && !offlineMode ? (
        <ReservationForm
          isOpen={showCreateForm}
          mode="create"
          restaurants={restaurants}
          defaultRestaurantId={defaultFormRestaurantId}
          onClose={() => setShowCreateForm(false)}
          onSuccess={(reservation) => {
            setShowCreateForm(false)
            if (reservation) {
              handleReservationChange({
                type: "create",
                reservation: reservation as ReservationRecord,
                statsDirty: true,
              })
            } else {
              void fetchDashboardSnapshot()
            }
          }}
        />
      ) : null}
    </div>
  )
}
