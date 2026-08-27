"use client"

import type React from "react"

import { Suspense, useCallback, useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowRight, ChevronDown, Plus, Search, SlidersHorizontal } from "lucide-react"
import { getReservations } from "../actions"
import { ReservationTable } from "@/components/manage/reservation-table"
import { ReservationForm } from "@/components/manage/reservation-form"
import { LoadingOverlay, OrbLoader } from "@/components/ui/orb-loader"
import { useLanguage } from "@/context/language-context"
import { useManageContext } from "@/context/manage-context"
import {
  readManageOfflineCache,
  writeManageOfflineCache,
  type ManageCachedReservation,
} from "@/lib/manage-offline-cache"

type Reservation = ManageCachedReservation
type RestaurantOption = { id: string; name: string; meal_only_reservations?: boolean }

function getLocalDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function getDateWithOffset(offset: number) {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + offset)
  return getLocalDateKey(date)
}

function applyReservationFilters(
  reservations: Reservation[],
  filters: {
    status?: string
    restaurantId?: string
    dateRange?: string
    searchQuery?: string
    reservationId?: string
  }
) {
  let filtered = reservations

  if (filters.status && filters.status !== "all") {
    filtered = filtered.filter((reservation) => reservation.status === filters.status)
  }

  if (filters.restaurantId && filters.restaurantId !== "all") {
    filtered = filtered.filter((reservation) => reservation.restaurant_id === filters.restaurantId)
  }

  if (filters.reservationId?.trim()) {
    filtered = filtered.filter((reservation) => reservation.id === filters.reservationId?.trim())
  }

  if (filters.dateRange === "today") {
    filtered = filtered.filter((reservation) => reservation.reservation_date === getDateWithOffset(0))
  } else if (filters.dateRange === "tomorrow") {
    filtered = filtered.filter((reservation) => reservation.reservation_date === getDateWithOffset(1))
  } else if (filters.dateRange === "week") {
    filtered = filtered.filter((reservation) => (
      reservation.reservation_date >= getDateWithOffset(0) &&
      reservation.reservation_date <= getDateWithOffset(7)
    ))
  } else if (filters.dateRange === "month") {
    filtered = filtered.filter((reservation) => (
      reservation.reservation_date >= getDateWithOffset(0) &&
      reservation.reservation_date <= getDateWithOffset(30)
    ))
  }

  if (filters.searchQuery?.trim()) {
    const searchTerm = filters.searchQuery.toLowerCase().trim()
    filtered = filtered.filter((reservation) => {
      const customerName = reservation.customer_name?.toLowerCase() || ""
      const customerPhone = reservation.customer_phone?.toLowerCase() || ""
      const customerEmail = reservation.customer_email?.toLowerCase() || ""
      const restaurantName = reservation.restaurants?.name?.toLowerCase() || ""
      const areaName = reservation.reservation_areas?.name?.toLowerCase() || ""

      return (
        customerName.includes(searchTerm) ||
        customerPhone.includes(searchTerm) ||
        customerEmail.includes(searchTerm) ||
        restaurantName.includes(searchTerm) ||
        areaName.includes(searchTerm)
      )
    })
  }

  return [...filtered].sort((a, b) => {
    const createdCompare = new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    if (createdCompare !== 0) return createdCompare
    const dateCompare = b.reservation_date.localeCompare(a.reservation_date)
    if (dateCompare !== 0) return dateCompare
    return b.reservation_time.localeCompare(a.reservation_time)
  })
}

function ReservationsPageContent() {
  const { getTranslation } = useLanguage()
  const { restaurants: contextRestaurants } = useManageContext()
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [restaurants, setRestaurants] = useState<RestaurantOption[]>([])
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false)
  const [offlineMode, setOfflineMode] = useState(false)
  const [offlineSyncedAt, setOfflineSyncedAt] = useState<string | null>(null)
  const searchParams = useSearchParams()
  const [filters, setFilters] = useState({
    status: "all",
    restaurantId: "all",
    dateRange: "all",
    searchQuery: "",
    reservationId: "",
  })
  const hasLoadedReservationsRef = useRef(false)
  const offlineModeRef = useRef(false)
  const onlineRecoveryInFlightRef = useRef(false)
  const restaurantsRef = useRef<RestaurantOption[]>([])

  useEffect(() => {
    restaurantsRef.current = restaurants
  }, [restaurants])

  const loadReservationsFromOfflineCache = useCallback(() => {
    const cache = readManageOfflineCache()
    offlineModeRef.current = true
    setOfflineMode(true)
    setOfflineSyncedAt(cache?.syncedAt || null)
    setShowCreateForm(false)
    setReservations(cache ? applyReservationFilters(cache.reservations, filters) : [])
    if (cache?.restaurants.length) {
      setRestaurants(cache.restaurants)
    }
  }, [filters])

  const flushCurrentReservationsToOfflineCache = useCallback(() => {
    if (reservations.length === 0 && restaurants.length === 0) {
      return
    }

    const cache = writeManageOfflineCache({
      reservations,
      restaurants,
    })
    if (cache) {
      setOfflineSyncedAt(cache.syncedAt)
    }
  }, [reservations, restaurants])

  const fetchReservations = useCallback(async ({ fullLoader = false }: { fullLoader?: boolean } = {}) => {
    const shouldUseFullLoader = fullLoader || !hasLoadedReservationsRef.current

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      loadReservationsFromOfflineCache()
      hasLoadedReservationsRef.current = true
      setIsLoading(false)
      setIsRefreshing(false)
      return
    }

    if (shouldUseFullLoader) {
      setIsLoading(true)
    } else {
      setIsRefreshing(true)
    }
    try {
      const result = await getReservations(filters)
      if (result?.success) {
        onlineRecoveryInFlightRef.current = false
        setOfflineMode(false)
        const nextReservations = (result.data || []) as Reservation[]
        setReservations(nextReservations)
        const cache = writeManageOfflineCache({
          reservations: nextReservations,
          restaurants: restaurantsRef.current,
        })
        if (cache) {
          setOfflineSyncedAt(cache.syncedAt)
        }
      } else {
        loadReservationsFromOfflineCache()
      }
    } catch (error) {
      console.error("Error fetching reservations:", error)
      loadReservationsFromOfflineCache()
    } finally {
      hasLoadedReservationsRef.current = true
      if (shouldUseFullLoader) {
        setIsLoading(false)
      } else {
        setIsRefreshing(false)
      }
    }
  }, [filters, loadReservationsFromOfflineCache])

  useEffect(() => {
    setRestaurants(contextRestaurants)
    restaurantsRef.current = contextRestaurants

    if (contextRestaurants.length === 0) {
      const cache = readManageOfflineCache()
      if (cache?.restaurants.length) {
        setRestaurants(cache.restaurants)
      }
      if (!hasLoadedReservationsRef.current) {
        const cache = readManageOfflineCache()
        setOfflineSyncedAt(cache?.syncedAt || null)
      }
    }

    // Check URL parameters for auto-opening create form
    const urlParams = new URLSearchParams(window.location.search)
    if (urlParams.get('action') === 'new') {
      setShowCreateForm(true)
      // Clean up URL without refreshing
      window.history.replaceState({}, '', '/manage/reservations')
    }

  }, [contextRestaurants])

  useEffect(() => {
    const reservationId = searchParams.get("reservationId")
    if (reservationId) {
      setFilters({
        status: "all",
        restaurantId: "all",
        dateRange: "all",
        searchQuery: "",
        reservationId,
      })
    }
  }, [searchParams])

  useEffect(() => {
    offlineModeRef.current = offlineMode
  }, [offlineMode])

  useEffect(() => {
    if (typeof window === "undefined") return

    const handleOffline = () => {
      if (offlineModeRef.current) {
        return
      }

      onlineRecoveryInFlightRef.current = false
      offlineModeRef.current = true
      flushCurrentReservationsToOfflineCache()
      loadReservationsFromOfflineCache()
      hasLoadedReservationsRef.current = true
      setIsLoading(false)
      setIsRefreshing(false)
    }

    const handleOnline = () => {
      onlineRecoveryInFlightRef.current = false
      offlineModeRef.current = false
      void fetchReservations({ fullLoader: false })
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
  }, [fetchReservations, flushCurrentReservationsToOfflineCache, loadReservationsFromOfflineCache])

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
      void fetchReservations({ fullLoader: false }).finally(() => {
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
  }, [fetchReservations, offlineMode])

  // Auto-fetch reservations when filters change
  useEffect(() => {
    const cachedReservations = readManageOfflineCache()
    const hasCachedReservations = Boolean(cachedReservations)
    if (cachedReservations) {
      offlineModeRef.current = false
      setOfflineMode(false)
      setOfflineSyncedAt(cachedReservations.syncedAt)
      setReservations(applyReservationFilters(cachedReservations.reservations, filters))
      if (cachedReservations.restaurants.length) {
        setRestaurants(cachedReservations.restaurants)
        restaurantsRef.current = cachedReservations.restaurants
      }
      hasLoadedReservationsRef.current = true
      setIsLoading(false)
    }

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      loadReservationsFromOfflineCache()
      return
    }

    const timeoutId = setTimeout(() => {
      void fetchReservations({ fullLoader: !hasCachedReservations })
    }, hasCachedReservations ? 0 : 300) // Show cached data immediately, then refresh in the background.

    return () => clearTimeout(timeoutId)
  }, [filters, fetchReservations, loadReservationsFromOfflineCache])

  const handleFilterChange = (key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    fetchReservations({ fullLoader: false })
  }

  const resetFilters = () => {
    setFilters({
      status: "all",
      restaurantId: "all",
      dateRange: "all",
      searchQuery: "",
      reservationId: "",
    })
    window.history.replaceState({}, '', '/manage/reservations')
  }

  const handleRefresh = () => {
    fetchReservations({ fullLoader: false })
  }

  const hasActiveReservationFilters = Boolean(
    filters.status !== "all" ||
    filters.restaurantId !== "all" ||
    filters.dateRange !== "all" ||
    filters.searchQuery.trim() ||
    filters.reservationId.trim(),
  )

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-white dark:bg-[#050506]">
        <div className="text-center">
          <OrbLoader label={getTranslation("manage.common.loadingReservations")} state="searching" />
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-[1400px] mx-auto">
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

      <Card className="mx-auto mb-6 w-full rounded-2xl border shadow-sm md:max-w-2xl">
        <CardContent className="p-3 sm:p-4">
          <form onSubmit={handleSearch}>
            <div className="relative overflow-hidden rounded-full border border-slate-200 bg-white shadow-sm transition-all focus-within:border-slate-400 focus-within:ring-2 focus-within:ring-slate-200">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-400/80" />
              <Input
                aria-label={getTranslation("manage.reservations.filters.search")}
                className="h-12 min-w-0 border-0 bg-transparent py-0 pl-11 pr-12 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                placeholder={getTranslation("manage.reservations.filters.searchPlaceholder")}
                value={filters.searchQuery}
                onChange={(e) => handleFilterChange("searchQuery", e.target.value)}
              />
              <button
                type="submit"
                className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-slate-500/70 transition-all hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                aria-label={getTranslation("manage.reservations.filters.search")}
                title={getTranslation("manage.reservations.filters.search")}
              >
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setAdvancedFiltersOpen((open) => !open)}
                className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
                aria-expanded={advancedFiltersOpen}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {getTranslation("manage.reservations.filters.advanced")}
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${advancedFiltersOpen ? "rotate-180" : ""}`} />
              </button>
              {(filters.status !== "all" || filters.restaurantId !== "all" || filters.dateRange !== "all" || filters.searchQuery) && (
                <button type="button" onClick={resetFilters} className="h-7 px-2 text-xs font-medium text-slate-500 hover:text-slate-900">
                  {getTranslation("manage.reservations.filters.reset")}
                </button>
              )}
            </div>

            {advancedFiltersOpen && (
              <div className="mt-2 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                <div className="min-w-[140px] flex-1 space-y-1">
                  <label className="text-[11px] font-medium text-slate-500">{getTranslation("manage.reservations.filters.status")}</label>
                  <Select value={filters.status} onValueChange={(value) => handleFilterChange("status", value)}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{getTranslation("manage.reservations.filters.statusAll")}</SelectItem>
                      <SelectItem value="pending">{getTranslation("manage.reservations.filters.statusPending")}</SelectItem>
                      <SelectItem value="confirmed">{getTranslation("manage.reservations.filters.statusConfirmed")}</SelectItem>
                      <SelectItem value="cancelled">{getTranslation("manage.reservations.filters.statusCancelled")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-[140px] flex-1 space-y-1">
                  <label className="text-[11px] font-medium text-slate-500">{getTranslation("manage.reservations.filters.dateRange")}</label>
                  <Select value={filters.dateRange} onValueChange={(value) => handleFilterChange("dateRange", value)}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{getTranslation("manage.reservations.filters.dateAll")}</SelectItem>
                      <SelectItem value="today">{getTranslation("manage.reservations.filters.dateToday")}</SelectItem>
                      <SelectItem value="tomorrow">{getTranslation("manage.reservations.filters.dateTomorrow")}</SelectItem>
                      <SelectItem value="week">{getTranslation("manage.reservations.filters.dateWeek")}</SelectItem>
                      <SelectItem value="month">{getTranslation("manage.reservations.filters.dateMonth")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-[140px] flex-1 space-y-1">
                  <label className="text-[11px] font-medium text-slate-500">{getTranslation("manage.reservationForm.restaurant")}</label>
                  <Select value={filters.restaurantId} onValueChange={(value) => handleFilterChange("restaurantId", value)}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{getTranslation("manage.dashboard.filter.allRestaurants")}</SelectItem>
                      {restaurants.map((restaurant) => <SelectItem key={restaurant.id} value={restaurant.id}>{restaurant.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      <Card className="relative rounded-2xl border-0 bg-transparent shadow-none sm:border sm:bg-card sm:shadow-sm">
        {isRefreshing ? (
          <LoadingOverlay label={getTranslation("manage.common.loadingReservations")} state="searching" size="md" />
        ) : null}
        <CardContent className="p-0 sm:p-6 sm:pt-0">
          <ReservationTable
            reservations={reservations}
            onRefresh={handleRefresh}
            itemsPerPage={20}
            readOnly={offlineMode}
            emptyMessage={offlineMode && !offlineSyncedAt ? getTranslation("manage.offline.empty") : undefined}
            emptyTitle={offlineMode && !offlineSyncedAt
              ? undefined
              : hasActiveReservationFilters
                ? getTranslation("manage.reservations.list.emptyFilteredTitle")
                : undefined}
            emptyDescription={offlineMode && !offlineSyncedAt
              ? undefined
              : hasActiveReservationFilters
                ? getTranslation("manage.reservations.list.emptyFilteredDescription")
                : undefined}
            headerContent={(
              <div className="min-w-0">
                <h2 className="text-base font-semibold leading-tight sm:text-lg">
                  {getTranslation("manage.reservations.list.title")}
                </h2>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {getTranslation("manage.reservations.list.showing", { count: String(reservations.length) })}
                  {isRefreshing ? ` · ${getTranslation("manage.common.loadingReservations")}` : ""}
                </p>
              </div>
            )}
          />
        </CardContent>
      </Card>

      {showCreateForm && !offlineMode && (
        <ReservationForm
          isOpen={showCreateForm}
          mode="create"
          restaurants={restaurants}
          onClose={() => setShowCreateForm(false)}
          onSuccess={() => {
            setShowCreateForm(false)
            fetchReservations({ fullLoader: false })
          }}
        />
      )}

      {!offlineMode && !showCreateForm && (
        <Button
          type="button"
          onClick={() => setShowCreateForm(true)}
          className="reservation-add-fab fixed bottom-4 right-4 z-30 h-10 rounded-lg bg-[#050506] px-3 text-white shadow-lg shadow-black/25 transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#1b1c21] hover:shadow-xl sm:bottom-5 sm:right-5 sm:h-12 sm:rounded-xl sm:px-4 dark:bg-[#f8fafc] dark:text-[#050506] dark:hover:bg-white"
          aria-label={getTranslation("manage.reservations.list.addReservation")}
          title={getTranslation("manage.reservations.list.addReservation")}
        >
          <Plus className="mr-1 h-3.5 w-3.5 sm:h-4 sm:w-4" />
          <span className="whitespace-nowrap text-xs font-semibold sm:text-sm">
            Add
          </span>
        </Button>
      )}
    </div>
  )
}

export default function ReservationsPage() {
  return (
    <Suspense
      fallback={
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white dark:bg-[#050506]">
          <div className="text-center">
            <OrbLoader label="Loading reservations..." state="searching" />
          </div>
        </div>
      }
    >
      <ReservationsPageContent />
    </Suspense>
  )
}
