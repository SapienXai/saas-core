"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import {
  Armchair,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  FileDown,
  Filter,
  Phone,
  Plus,
  Search,
  StickyNote,
  Users,
  Utensils,
  Wine,
  X,
} from "lucide-react"
import { getRestaurantOptions } from "@/app/manage/actions"
import { assignReservationTable, getSeatingReservations } from "@/app/manage/seating-actions"
import { ReservationForm } from "@/components/manage/reservation-form"
import { useLanguage } from "@/context/language-context"
import { toast } from "sonner"
import { OrbLoader } from "@/components/ui/orb-loader"
import {
  readManageOfflineCache,
  writeManageOfflineCache,
  type ManageCachedReservation,
} from "@/lib/manage-offline-cache"

type SeatingReservation = {
  id: string
  restaurant_id: string
  reservation_date: string
  reservation_time: string
  created_at: string
  customer_name: string
  customer_phone: string
  party_size: number
  table_number: string | null
  reservation_type: string | null
  notes: string | null
  status: string | null
  booked_by_label?: string | null
  booked_by_name?: string
  restaurants?: {
    id: string
    name: string
  } | null
}

type RestaurantOption = {
  id: string
  name: string
}

function todayAsYYYYMMDD() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function mapCachedReservationToSeating(reservation: ManageCachedReservation): SeatingReservation {
  return {
    id: reservation.id,
    restaurant_id: reservation.restaurant_id,
    reservation_date: reservation.reservation_date,
    reservation_time: reservation.reservation_time,
    created_at: reservation.created_at,
    customer_name: reservation.customer_name,
    customer_phone: reservation.customer_phone,
    party_size: reservation.party_size,
    table_number: reservation.table_number,
    reservation_type: reservation.reservation_type,
    notes: reservation.notes || reservation.special_requests || null,
    status: reservation.status,
    booked_by_label: reservation.booked_by_label,
    booked_by_name: reservation.booked_by_name || reservation.booked_by_label || "Online",
    restaurants: reservation.restaurants || null,
  }
}

function applySeatingFilters(reservations: ManageCachedReservation[], filters: {
  date?: string
  restaurantId?: string
  status?: string
  searchQuery?: string
}) {
  let rows = reservations.map(mapCachedReservationToSeating)

  if (filters.date) {
    rows = rows.filter((reservation) => reservation.reservation_date === filters.date)
  }

  if (filters.restaurantId && filters.restaurantId !== "all") {
    rows = rows.filter((reservation) => reservation.restaurant_id === filters.restaurantId)
  }

  if (filters.status && filters.status !== "all") {
    rows = rows.filter((reservation) => reservation.status === filters.status)
  }

  if (filters.searchQuery?.trim()) {
    const term = filters.searchQuery.trim().toLowerCase()
    rows = rows.filter((reservation) => {
      const haystack = [
        reservation.customer_name || "",
        reservation.customer_phone || "",
        reservation.table_number || "",
        reservation.notes || "",
        reservation.booked_by_name || "",
        reservation.restaurants?.name || "",
      ].join(" ").toLowerCase()
      return haystack.includes(term)
    })
  }

  return rows.sort((a, b) => {
    const timeCompare = a.reservation_time.localeCompare(b.reservation_time)
    if (timeCompare !== 0) return timeCompare
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  })
}

export default function SeatingPage() {
  const router = useRouter()
  const { currentLang, getTranslation, translateMessage } = useLanguage()
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [offlineMode, setOfflineMode] = useState(false)
  const [offlineSyncedAt, setOfflineSyncedAt] = useState<string | null>(null)
  const [reservations, setReservations] = useState<SeatingReservation[]>([])
  const [restaurants, setRestaurants] = useState<RestaurantOption[]>([])
  const [filters, setFilters] = useState({
    date: todayAsYYYYMMDD(),
    status: "confirmed",
    restaurantId: "all",
    searchQuery: "",
  })
  const [selected, setSelected] = useState<SeatingReservation | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [isExportingPdf, setIsExportingPdf] = useState(false)
  const [tableNumber, setTableNumber] = useState("")
  const [reservationType, setReservationType] = useState("meal")
  const [notes, setNotes] = useState("")
  const [bookedByText, setBookedByText] = useState("")
  const [showMobileFilters, setShowMobileFilters] = useState(false)
  const [expandedMobileCards, setExpandedMobileCards] = useState<Record<string, boolean>>({})
  const offlineModeRef = useRef(false)
  const onlineRecoveryInFlightRef = useRef(false)
  const hasHydratedCacheRef = useRef(false)
  const hasStartedInitialLoadRef = useRef(false)

  useEffect(() => {
    offlineModeRef.current = offlineMode
  }, [offlineMode])

  const loadSeatingFromOfflineCache = useCallback(() => {
    const cache = readManageOfflineCache()
    offlineModeRef.current = true
    setOfflineMode(true)
    setOfflineSyncedAt(cache?.syncedAt || null)
    setShowCreateForm(false)
    setSelected(null)
    setReservations(cache ? applySeatingFilters(cache.reservations, filters) : [])
    if (cache?.restaurants.length) {
      setRestaurants(cache.restaurants)
    }
    setIsLoading(false)
    setIsSaving(false)
  }, [filters])

  const flushCurrentSeatingToOfflineCache = useCallback(() => {
    if (reservations.length === 0 && restaurants.length === 0) {
      return
    }

    const cache = writeManageOfflineCache({
      reservations: reservations as unknown as ManageCachedReservation[],
      restaurants,
    })
    if (cache) {
      setOfflineSyncedAt(cache.syncedAt)
    }
  }, [reservations, restaurants])

  const loadRestaurants = useCallback(async () => {
    try {
      const result = await getRestaurantOptions()
      if (result?.success) {
        const list = (result.data || []) as RestaurantOption[]
        setRestaurants(list)
        if (list.length === 1) {
          setFilters((prev) => ({ ...prev, restaurantId: list[0].id }))
        }
        return
      }
    } catch (error) {
      console.error("Error loading seating restaurants:", error)
    }

    const cache = readManageOfflineCache()
    if (cache?.restaurants.length) {
      setRestaurants(cache.restaurants)
    }
  }, [])

  const fetchList = useCallback(async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      loadSeatingFromOfflineCache()
      return
    }

    if (!hasHydratedCacheRef.current) setIsLoading(true)
    try {
      const result = await getSeatingReservations({
        date: filters.date,
        status: filters.status,
        restaurantId: filters.restaurantId,
        searchQuery: filters.searchQuery,
      })

      if (result?.success) {
        setReservations(result.data as SeatingReservation[])
        hasHydratedCacheRef.current = true
        onlineRecoveryInFlightRef.current = false
        setOfflineMode(false)
      } else {
        loadSeatingFromOfflineCache()
        toast.error(translateMessage(result.message || getTranslation("manage.seating.loadError")))
      }
    } catch {
      loadSeatingFromOfflineCache()
      toast.error(getTranslation("manage.seating.loadError"))
    } finally {
      setIsLoading(false)
    }
  }, [filters, getTranslation, loadSeatingFromOfflineCache, translateMessage])

  useEffect(() => {
    if (hasStartedInitialLoadRef.current) return
    hasStartedInitialLoadRef.current = true
    const cache = readManageOfflineCache()
    if (cache) {
      hasHydratedCacheRef.current = true
      offlineModeRef.current = false
      setOfflineMode(false)
      setOfflineSyncedAt(cache.syncedAt)
      setReservations(applySeatingFilters(cache.reservations, filters))
      setRestaurants(cache.restaurants)
      setIsLoading(false)
    }
    loadRestaurants()
  }, [filters, loadRestaurants])

  useEffect(() => {
    fetchList()
  }, [fetchList])

  useEffect(() => {
    if (typeof window === "undefined") return

    const handleOffline = () => {
      if (offlineModeRef.current) {
        return
      }

      onlineRecoveryInFlightRef.current = false
      offlineModeRef.current = true
      flushCurrentSeatingToOfflineCache()
      loadSeatingFromOfflineCache()
    }

    const handleOnline = () => {
      onlineRecoveryInFlightRef.current = false
      offlineModeRef.current = false
      void fetchList()
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
  }, [fetchList, flushCurrentSeatingToOfflineCache, loadSeatingFromOfflineCache])

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
      void fetchList().finally(() => {
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
  }, [fetchList, offlineMode])

  const openEdit = (reservation: SeatingReservation) => {
    setSelected(reservation)
    setTableNumber(reservation.table_number || "")
    setReservationType(reservation.reservation_type === "drinks" ? "drinks" : "meal")
    setNotes(reservation.notes || "")
    setBookedByText(reservation.booked_by_name || getTranslation("manage.seating.online"))
  }

  const closeEdit = () => {
    setSelected(null)
    setTableNumber("")
    setReservationType("meal")
    setNotes("")
    setBookedByText("")
  }

  const saveAssignment = async () => {
    if (!selected || offlineMode) return
    setIsSaving(true)
    try {
      const result = await assignReservationTable({
        reservationId: selected.id,
        tableNumber,
        reservationType,
        notes,
        bookedByText,
      })
      if (result?.success) {
        toast.success(getTranslation("manage.seating.updateSuccess"))
        closeEdit()
        fetchList()
      } else {
        toast.error(translateMessage(result.message || getTranslation("manage.seating.updateError")))
      }
    } catch {
      toast.error(getTranslation("manage.seating.updateError"))
    } finally {
      setIsSaving(false)
    }
  }

  const rowCountLabel = useMemo(
    () => getTranslation("manage.seating.listCount", { count: String(reservations.length) }),
    [getTranslation, reservations.length]
  )
  const totalPax = useMemo(
    () => reservations.reduce((sum, reservation) => sum + (reservation.party_size || 0), 0),
    [reservations]
  )
  const totalDiningPax = useMemo(
    () => reservations.reduce((sum, reservation) => (
      reservation.reservation_type === "drinks" ? sum : sum + (reservation.party_size || 0)
    ), 0),
    [reservations]
  )
  const assignedReservations = useMemo(
    () => reservations.filter((reservation) => Boolean(reservation.table_number?.trim())).length,
    [reservations]
  )
  const unassignedReservations = reservations.length - assignedReservations
  const suggestedTables = useMemo(() => (
    Array.from(new Set(
      reservations
        .map((reservation) => reservation.table_number?.trim())
        .filter((table): table is string => Boolean(table))
    )).slice(0, 8)
  ), [reservations])
  const dateLabel = useMemo(() => {
    const date = new Date(`${filters.date}T12:00:00`)
    if (Number.isNaN(date.getTime())) return filters.date

    const locale = currentLang === "tr" ? "tr-TR" : currentLang === "es" ? "es-ES" : "en-US"
    return new Intl.DateTimeFormat(locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(date)
  }, [currentLang, filters.date])
  const isToday = filters.date === todayAsYYYYMMDD()
  const statusOptions = useMemo(() => [
    { value: "all", label: getTranslation("manage.seating.statusAll") },
    { value: "pending", label: getTranslation("manage.seating.statusPending") },
    { value: "confirmed", label: getTranslation("manage.seating.statusConfirmed") },
    { value: "cancelled", label: getTranslation("manage.seating.statusCancelled") },
    { value: "completed", label: getTranslation("manage.seating.statusCompleted") },
  ], [getTranslation])
  const getReservationTypeLabel = useCallback((type?: string | null) => (
    type === "drinks"
      ? getTranslation("manage.seating.typeDrinks")
      : getTranslation("manage.seating.typeMeal")
  ), [getTranslation])
  const getReservationTypeBadgeClassName = useCallback((type?: string | null) => (
    type === "drinks"
      ? "bg-slate-900 text-white"
      : "bg-rose-900 text-white"
  ), [])

  const shiftDate = (days: number) => {
    const date = new Date(`${filters.date}T12:00:00`)
    date.setDate(date.getDate() + days)
    const nextDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
    setFilters((prev) => ({ ...prev, date: nextDate }))
  }

  const handlePrintPdf = async () => {
    const params = new URLSearchParams()
    if (filters.date) params.set("date", filters.date)
    if (filters.restaurantId) params.set("restaurantId", filters.restaurantId)
    if (filters.status) params.set("status", filters.status)
    if (filters.searchQuery) params.set("searchQuery", filters.searchQuery)
    if (currentLang) params.set("lang", currentLang)

    const pdfUrl = `/manage/seating/pdf?${params.toString()}`
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (
      navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1
    )

    if (isIOS && typeof navigator.share === "function" && typeof navigator.canShare === "function") {
      setIsExportingPdf(true)
      try {
        const response = await fetch(pdfUrl)
        if (!response.ok) throw new Error("Unable to prepare PDF")

        const pdfFile = new File(
          [await response.blob()],
          `felix-service-list-${filters.date || "today"}.pdf`,
          { type: "application/pdf" }
        )

        if (navigator.canShare({ files: [pdfFile] })) {
          await navigator.share({
            files: [pdfFile],
            title: getTranslation("manage.seating.exportPdf"),
          })
          return
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return
        }
      } finally {
        setIsExportingPdf(false)
      }
    }

    router.push(pdfUrl)
  }

  const toggleMobileCardDetails = (id: string) => {
    setExpandedMobileCards((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <div className="seating-page w-full">
      <div className="mb-4 flex flex-col gap-3 sm:mb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-violet-600 dark:text-violet-300">
            <Armchair className="h-3.5 w-3.5" />
            {getTranslation("manage.sidebar.seating")}
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-white sm:text-[2rem]">
            {getTranslation("manage.seating.title")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-5 text-slate-500 dark:text-slate-400">
            {getTranslation("manage.seating.filtersDescription")}
          </p>
        </div>

        {!offlineMode ? (
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
            <Button onClick={() => setShowCreateForm(true)} className="h-10 w-full rounded-xl px-3 sm:w-auto sm:px-4">
              <Plus className="h-4 w-4" />
              <span>{getTranslation("manage.reservations.list.addReservation")}</span>
            </Button>
            <Button variant="outline" onClick={handlePrintPdf} loading={isExportingPdf} className="h-10 w-full rounded-xl px-3 sm:w-auto sm:px-4">
              {!isExportingPdf && <FileDown className="h-4 w-4" />}
              <span className="truncate">{isExportingPdf ? getTranslation("manage.seating.preparingPdf") : getTranslation("manage.seating.exportPdf")}</span>
            </Button>
          </div>
        ) : null}
      </div>

      {offlineMode ? (
        <Card className="mb-4 border-amber-200 bg-amber-50 dark:border-amber-400/20 dark:bg-amber-500/[0.08]">
          <CardContent className="flex gap-3 p-3 text-sm text-amber-900 dark:text-amber-100">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-semibold">{getTranslation("manage.offline.title")}</div>
              <div className="mt-0.5 text-xs leading-5 opacity-80">
                {offlineSyncedAt
                  ? getTranslation("manage.offline.description", {
                      syncedAt: new Date(offlineSyncedAt).toLocaleString(getTranslation("common.locale") || "en-US"),
                    })
                  : getTranslation("manage.offline.noCache")}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card className="seating-toolbar mb-3 border-slate-200/80 bg-white/80 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => shiftDate(-1)}
                  aria-label={getTranslation("manage.seating.previousDay")}
                  className="h-9 w-9 shrink-0 rounded-xl"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="min-w-0 px-2 text-center">
                  <div className="truncate text-sm font-bold text-slate-900 dark:text-white">{dateLabel}</div>
                  <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                    {isToday ? getTranslation("manage.seating.today") : filters.date}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => shiftDate(1)}
                  aria-label={getTranslation("manage.seating.nextDay")}
                  className="h-9 w-9 shrink-0 rounded-xl"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                {!isToday && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setFilters((prev) => ({ ...prev, date: todayAsYYYYMMDD() }))} className="hidden h-9 rounded-xl px-2.5 text-xs font-semibold text-violet-700 hover:text-violet-800 sm:inline-flex dark:text-violet-200">
                    {getTranslation("manage.seating.today")}
                  </Button>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <label className="relative hidden items-center sm:flex">
                  <CalendarDays className="pointer-events-none absolute left-3 h-4 w-4 text-slate-400" />
                  <Input
                    aria-label={getTranslation("manage.seating.date")}
                    type="date"
                    value={filters.date}
                    onChange={(event) => setFilters((prev) => ({ ...prev, date: event.target.value }))}
                    className="h-9 w-[148px] rounded-xl pl-9 text-xs"
                  />
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowMobileFilters((prev) => !prev)}
                  aria-expanded={showMobileFilters}
                  aria-controls="seating-filters"
                  className="h-9 rounded-xl px-2.5 text-xs sm:hidden"
                >
                  <Filter className="h-3.5 w-3.5" />
                  {getTranslation("manage.seating.filtersTitle")}
                  {showMobileFilters ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(150px,0.35fr)_minmax(130px,0.25fr)]">
              <div className="relative min-w-0">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  aria-label={getTranslation("manage.seating.search")}
                  placeholder={getTranslation("manage.seating.searchPlaceholder")}
                  value={filters.searchQuery}
                  onChange={(event) => setFilters((prev) => ({ ...prev, searchQuery: event.target.value }))}
                  className="h-10 rounded-xl pl-9 pr-9 text-sm"
                />
                {filters.searchQuery && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={getTranslation("manage.seating.clearSearch")}
                    onClick={() => setFilters((prev) => ({ ...prev, searchQuery: "" }))}
                    className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>

              <div id="seating-filters" className={`${showMobileFilters ? "grid" : "hidden"} min-w-0 grid-cols-1 gap-2 sm:grid`}>
                <Select
                  value={filters.restaurantId}
                  onValueChange={(value) => setFilters((prev) => ({ ...prev, restaurantId: value }))}
                >
                  <SelectTrigger aria-label={getTranslation("manage.seating.restaurant")} className="h-10 w-full min-w-0 rounded-xl justify-start pr-8 text-left text-sm [&>span]:truncate [&>span]:text-left">
                    <SelectValue placeholder={getTranslation("manage.seating.restaurant")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{getTranslation("manage.seating.allRestaurants")}</SelectItem>
                    {restaurants.map((restaurant) => (
                      <SelectItem key={restaurant.id} value={restaurant.id}>{restaurant.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className={`${showMobileFilters ? "grid" : "hidden"} min-w-0 grid-cols-1 gap-2 sm:grid`}>
                <Select
                  value={filters.status}
                  onValueChange={(value) => setFilters((prev) => ({ ...prev, status: value }))}
                >
                  <SelectTrigger aria-label={getTranslation("manage.seating.status")} className="h-10 w-full min-w-0 rounded-xl text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statusOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:hidden">
              <CalendarDays className="h-4 w-4 shrink-0 text-slate-400" />
              <Input
                aria-label={getTranslation("manage.seating.date")}
                type="date"
                value={filters.date}
                onChange={(event) => setFilters((prev) => ({ ...prev, date: event.target.value }))}
                className="h-9 flex-1 rounded-xl text-sm"
              />
              {!isToday && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setFilters((prev) => ({ ...prev, date: todayAsYYYYMMDD() }))} className="h-9 rounded-xl px-2 text-xs font-semibold text-violet-700 dark:text-violet-200">
                  {getTranslation("manage.seating.today")}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        {[
          { label: getTranslation("manage.seating.totalReservations"), value: reservations.length, icon: CalendarDays, tone: "violet" },
          { label: getTranslation("manage.seating.totalKuver"), value: totalPax, icon: Users, tone: "blue" },
          { label: getTranslation("manage.seating.unassigned"), value: unassignedReservations, icon: CircleAlert, tone: "amber" },
          { label: getTranslation("manage.seating.totalDiningPax"), value: totalDiningPax, icon: Utensils, tone: "rose" },
        ].map(({ label, value, icon: Icon, tone }) => (
          <Card key={label} className="seating-stat-card border-slate-200/80 bg-white/80 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
            <CardContent className="flex items-center gap-2.5 p-3 sm:gap-3 sm:p-3.5">
              <div className={`seating-stat-icon seating-stat-icon-${tone}`}><Icon className="h-4 w-4" /></div>
              <div className="min-w-0">
                <div className="text-lg font-bold leading-none tracking-tight text-slate-950 dark:text-white sm:text-xl">{value}</div>
                <div className="mt-1 truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">{label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden border-slate-200/80 bg-white/80 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
        <CardHeader className="gap-3 border-b border-slate-200/80 p-4 dark:border-white/10 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="min-w-0">
            <CardTitle className="text-base font-bold tracking-tight text-slate-950 dark:text-white sm:text-lg">{getTranslation("manage.seating.listTitle")}</CardTitle>
            <CardDescription className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {rowCountLabel} · {assignedReservations} {getTranslation("manage.seating.assigned")} · {unassignedReservations} {getTranslation("manage.seating.unassigned")}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            {getTranslation("manage.seating.statusConfirmed")}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex min-h-32 items-center justify-center">
              <OrbLoader label={getTranslation("manage.seating.loading")} state="searching" size="sm" />
            </div>
          ) : reservations.length === 0 ? (
            <div className="flex min-h-40 flex-col items-center justify-center gap-2 px-5 text-center">
              <Armchair className="h-7 w-7 text-slate-300 dark:text-slate-600" />
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">{getTranslation("manage.seating.empty")}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{getTranslation("manage.seating.filtersDescription")}</div>
            </div>
          ) : (
            <>
              <div className="space-y-2 p-3 sm:hidden">
                {reservations.map((reservation) => {
                  const isExpanded = Boolean(expandedMobileCards[reservation.id])
                  const hasTable = Boolean(reservation.table_number?.trim())
                  const typeIsDrinks = reservation.reservation_type === "drinks"

                  return (
                    <article key={reservation.id} className="seating-reservation-card rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3 dark:border-white/10 dark:bg-white/[0.035]">
                      <div className="flex items-start gap-2.5">
                        <div className="seating-time-block shrink-0 rounded-xl px-2.5 py-2 text-center">
                          <div className="text-sm font-bold leading-none text-slate-950 dark:text-white">{reservation.reservation_time.slice(0, 5)}</div>
                          <div className="mt-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400">{reservation.party_size} {getTranslation("manage.seating.colPax")}</div>
                        </div>
                        <div className="min-w-0 flex-1 pt-0.5">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <h3 className="min-w-0 truncate text-sm font-bold text-slate-950 dark:text-white">{reservation.customer_name}</h3>
                            <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${getReservationTypeBadgeClassName(reservation.reservation_type)}`}>
                              {typeIsDrinks ? <Wine className="h-2.5 w-2.5" /> : <Utensils className="h-2.5 w-2.5" />}
                              {getReservationTypeLabel(reservation.reservation_type)}
                            </span>
                          </div>
                          <div className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{reservation.restaurants?.name || "-"}</div>
                        </div>
                        {!offlineMode ? (
                          <Button
                            type="button"
                            variant={hasTable ? "outline" : "default"}
                            size="sm"
                            onClick={() => openEdit(reservation)}
                            className={`h-9 max-w-[6.5rem] shrink-0 rounded-xl px-2.5 text-xs font-bold ${hasTable ? "border-violet-200 bg-white text-violet-700 hover:bg-violet-50 dark:border-violet-300/20 dark:bg-white/[0.04] dark:text-violet-200 dark:hover:bg-violet-500/10" : "bg-violet-600 text-white hover:bg-violet-700"}`}
                          >
                            <Armchair className="h-3.5 w-3.5" />
                            <span className="truncate">{hasTable ? reservation.table_number : getTranslation("manage.seating.assignShort")}</span>
                          </Button>
                        ) : (
                          <span className="rounded-xl bg-slate-200/70 px-2.5 py-2 text-xs font-bold text-slate-600 dark:bg-white/10 dark:text-slate-300">{hasTable ? reservation.table_number : getTranslation("manage.seating.unassigned")}</span>
                        )}
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-200/80 pt-2.5 dark:border-white/10">
                        <div className="flex min-w-0 items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                          <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{reservation.party_size}</span>
                          <span className="truncate">{reservation.booked_by_name || getTranslation("manage.seating.online")}</span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-expanded={isExpanded}
                          onClick={() => toggleMobileCardDetails(reservation.id)}
                          className="h-8 shrink-0 rounded-lg px-2 text-[11px] font-semibold text-slate-600 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white"
                        >
                          {isExpanded ? getTranslation("manage.seating.hideDetails") : getTranslation("manage.seating.showDetails")}
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </Button>
                      </div>

                      {isExpanded && (
                        <div className="mt-2 grid gap-2 rounded-xl bg-white/70 p-2.5 text-xs dark:bg-white/[0.04]">
                          <div className="flex min-w-0 items-center gap-2 text-slate-600 dark:text-slate-300">
                            <Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            {reservation.customer_phone ? <a className="truncate underline-offset-2 hover:underline" href={`tel:${reservation.customer_phone}`}>{reservation.customer_phone}</a> : "-"}
                          </div>
                          <div className="flex min-w-0 items-start gap-2 text-slate-600 dark:text-slate-300">
                            <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                            <span className="break-words">{reservation.notes || "-"}</span>
                          </div>
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>

              <div className="hidden overflow-x-auto sm:block">
                <Table className="w-full table-fixed">
                  <TableHeader>
                    <TableRow className="border-slate-200/80 hover:bg-transparent dark:border-white/10">
                      <TableHead className="w-[5.5rem]">{getTranslation("manage.seating.colTime")}</TableHead>
                      <TableHead>{getTranslation("manage.seating.colName")}</TableHead>
                      <TableHead className="w-[4.5rem]">{getTranslation("manage.seating.colPax")}</TableHead>
                      <TableHead className="w-[8.5rem]">{getTranslation("manage.seating.colTable")}</TableHead>
                      <TableHead className="w-[7rem]">{getTranslation("manage.seating.colType")}</TableHead>
                      <TableHead className="hidden lg:table-cell">{getTranslation("manage.seating.colNote")}</TableHead>
                      <TableHead className="w-[7.5rem] text-right">{getTranslation("manage.seating.colActions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reservations.map((reservation) => {
                      const hasTable = Boolean(reservation.table_number?.trim())
                      return (
                        <TableRow key={reservation.id} className="border-slate-200/70 dark:border-white/[0.07]">
                          <TableCell className="whitespace-nowrap align-top font-bold text-slate-950 dark:text-white">{reservation.reservation_time.slice(0, 5)}</TableCell>
                          <TableCell className="min-w-0 align-top">
                            <div className="truncate font-semibold text-slate-900 dark:text-slate-100">{reservation.customer_name}</div>
                            <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{reservation.restaurants?.name || "-"}</div>
                            <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                              <span className="inline-flex items-center gap-1 truncate"><Phone className="h-3 w-3 shrink-0" />{reservation.customer_phone || "-"}</span>
                              <span className="truncate">{reservation.booked_by_name || getTranslation("manage.seating.online")}</span>
                            </div>
                          </TableCell>
                          <TableCell className="align-top"><span className="inline-flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-200"><Users className="h-3.5 w-3.5 text-slate-400" />{reservation.party_size}</span></TableCell>
                          <TableCell className="align-top">
                            {!offlineMode ? (
                              <Button
                                type="button"
                                variant={hasTable ? "outline" : "default"}
                                size="sm"
                                onClick={() => openEdit(reservation)}
                                className={`h-8 max-w-full rounded-lg px-2.5 text-xs font-bold ${hasTable ? "border-violet-200 bg-white text-violet-700 hover:bg-violet-50 dark:border-violet-300/20 dark:bg-white/[0.04] dark:text-violet-200 dark:hover:bg-violet-500/10" : "bg-violet-600 text-white hover:bg-violet-700"}`}
                              >
                                <Armchair className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">{hasTable ? reservation.table_number : getTranslation("manage.seating.assignShort")}</span>
                              </Button>
                            ) : <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">{hasTable ? reservation.table_number : "-"}</span>}
                          </TableCell>
                          <TableCell className="align-top">
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold ${getReservationTypeBadgeClassName(reservation.reservation_type)}`}>
                              {reservation.reservation_type === "drinks" ? <Wine className="h-3 w-3" /> : <Utensils className="h-3 w-3" />}
                              {getReservationTypeLabel(reservation.reservation_type)}
                            </span>
                          </TableCell>
                          <TableCell className="hidden max-w-0 align-top lg:table-cell">
                            <div className="truncate text-sm text-slate-700 dark:text-slate-300" title={reservation.notes || undefined}>{reservation.notes || "-"}</div>
                          </TableCell>
                          <TableCell className="align-top text-right">
                            {!offlineMode ? (
                              <Button type="button" variant="ghost" size="sm" onClick={() => openEdit(reservation)} className="h-8 rounded-lg px-2.5 text-xs font-semibold text-slate-600 hover:text-violet-700 dark:text-slate-300 dark:hover:text-violet-200">
                                {getTranslation("manage.seating.assignButton")}
                              </Button>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 px-4 py-3 text-xs font-semibold text-slate-500 dark:border-white/10 dark:text-slate-400 sm:px-5">
                <span>{getTranslation("manage.seating.totalKuver")}: <strong className="text-slate-900 dark:text-white">{totalPax}</strong></span>
                <span>{getTranslation("manage.seating.totalDiningPax")}: <strong className="text-slate-900 dark:text-white">{totalDiningPax}</strong></span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {!offlineMode && (
        <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) closeEdit() }}>
          <DialogContent className="bottom-0 top-auto max-h-[calc(100dvh-1rem)] translate-y-0 overflow-y-auto rounded-b-none rounded-t-2xl border-slate-200/80 bg-white p-4 dark:border-white/10 dark:bg-[#0f1015] sm:bottom-auto sm:top-1/2 sm:max-h-[min(760px,calc(100dvh-2rem))] sm:translate-y-[-50%] sm:rounded-2xl sm:p-6">
            <DialogHeader className="text-left">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200"><Armchair className="h-5 w-5" /></div>
                <div className="min-w-0">
                  <DialogTitle className="text-lg font-bold">{getTranslation("manage.seating.dialogTitle")}</DialogTitle>
                  <DialogDescription className="mt-1 truncate">
                    {selected ? `${selected.customer_name} · ${selected.reservation_time.slice(0, 5)} · ${selected.party_size} ${getTranslation("manage.seating.colPax")}` : ""}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">{getTranslation("manage.seating.colTable")}</Label>
                <Input
                  autoFocus
                  inputMode="text"
                  placeholder={getTranslation("manage.seating.tablePlaceholder")}
                  value={tableNumber}
                  onChange={(event) => setTableNumber(event.target.value)}
                  className="h-12 rounded-xl text-base font-bold"
                />
                {suggestedTables.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{getTranslation("manage.seating.quickTables")}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {suggestedTables.map((table) => (
                        <Button key={table} type="button" variant="outline" size="sm" onClick={() => setTableNumber(table)} className={`h-8 rounded-lg px-2.5 text-xs font-bold ${tableNumber === table ? "border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200" : ""}`}>
                          {table}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">{getTranslation("manage.seating.colType")}</Label>
                  <Select value={reservationType} onValueChange={setReservationType}>
                    <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="meal"><span className="inline-flex items-center gap-2"><Utensils className="h-3.5 w-3.5" />{getTranslation("manage.seating.typeMeal")}</span></SelectItem>
                      <SelectItem value="drinks"><span className="inline-flex items-center gap-2"><Wine className="h-3.5 w-3.5" />{getTranslation("manage.seating.typeDrinks")}</span></SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">{getTranslation("manage.seating.colBookedBy")}</Label>
                  <Input
                    placeholder={getTranslation("manage.seating.bookedByPlaceholder")}
                    value={bookedByText}
                    onChange={(event) => setBookedByText(event.target.value)}
                    className="h-10 rounded-xl"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">{getTranslation("manage.seating.colNote")}</Label>
                <Textarea
                  placeholder={getTranslation("manage.seating.notePlaceholder")}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  className="min-h-20 rounded-xl text-sm"
                />
              </div>
            </div>

            <DialogFooter className="sticky bottom-0 -mx-4 -mb-4 gap-2 border-t border-slate-200/80 bg-white/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:mb-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-1 dark:border-white/10 dark:bg-[#0f1015]/95 sm:dark:bg-transparent">
              <Button type="button" variant="outline" onClick={closeEdit} className="h-10 rounded-xl sm:w-auto">{getTranslation("manage.seating.cancel")}</Button>
              <Button type="button" onClick={saveAssignment} loading={isSaving} className="h-10 rounded-xl sm:min-w-28">
                {isSaving ? getTranslation("manage.seating.saving") : getTranslation("manage.seating.save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {showCreateForm && !offlineMode && (
        <ReservationForm
          isOpen={showCreateForm}
          mode="create"
          onClose={() => setShowCreateForm(false)}
          onSuccess={() => {
            setShowCreateForm(false)
            fetchList()
          }}
        />
      )}
    </div>
  )
}
