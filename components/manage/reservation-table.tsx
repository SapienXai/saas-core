"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Bell, CheckCircle, XCircle, Clock, Calendar, ChevronDown, Grid, List, Mail, Phone, User, Utensils, Coffee, Copy } from "lucide-react"
import type { Reservation } from "@/types/supabase"
import { updateReservationStatus } from "@/app/manage/actions"
import { ReservationForm } from "./reservation-form"
import { ReservationActionsMenu } from "@/components/manage/reservation-actions-menu"
import { ReservationUpdateIndicator } from "@/components/manage/reservation-update-indicator"
import { usePagination } from "@/hooks/use-pagination"
import { PaginationControls } from "@/components/ui/pagination-controls"
import { toast } from "sonner"
import { useLanguage } from "@/context/language-context"
import { formatDate as formatLocalizedDate, formatTime as formatLocalizedTime } from "@/i18n"

interface ReservationWithRestaurant extends Reservation {
  restaurants?: {
    id: string
    name: string
  } | null
  reservation_areas?: {
    id: string
    name: string
  } | null
  booked_by_email?: string | null
  booked_by_label: string | null
  booked_by_name?: string | null
}

interface ReservationTableProps {
  reservations: ReservationWithRestaurant[]
  onRefresh: () => void
  itemsPerPage?: number
  readOnly?: boolean
  emptyMessage?: string
  emptyTitle?: string
  emptyDescription?: string
  headerContent?: ReactNode
}

const RESERVATION_LIST_VIEW_MODE_STORAGE_KEY = "felix-manage-reservation-list-view-mode"

export function ReservationTable({
  reservations,
  onRefresh,
  itemsPerPage = 10,
  readOnly = false,
  emptyMessage,
  emptyTitle,
  emptyDescription,
  headerContent,
}: ReservationTableProps) {
  const { currentLang, getTranslation } = useLanguage()
  const [selectedReservation, setSelectedReservation] = useState<ReservationWithRestaurant | null>(null)
  const [actionType, setActionType] = useState<"confirm" | "cancel" | null>(null)
  const [notes, setNotes] = useState("")
  const [showActionNotes, setShowActionNotes] = useState(false)
  const [sendEmail, setSendEmail] = useState(true)
  const [emailLang, setEmailLang] = useState<'en' | 'tr' | 'es'>('en')
  const [isLoading, setIsLoading] = useState(false)
  const [editingReservation, setEditingReservation] = useState<ReservationWithRestaurant | null>(null)
  const [currentItemsPerPage, setCurrentItemsPerPage] = useState(itemsPerPage)
  const [viewMode, setViewMode] = useState<"table" | "card">("card")
  const [hasLoadedViewMode, setHasLoadedViewMode] = useState(false)
  const [expandedDetailId, setExpandedDetailId] = useState<string | null>(null)
  const [copiedReservationId, setCopiedReservationId] = useState<string | null>(null)
  const copyResetTimeoutRef = useRef<number | null>(null)

  const {
    currentPage,
    totalPages,
    paginatedData,
    goToPage,
    canGoNext,
    canGoPrevious,
    startIndex,
    endIndex,
    totalItems,
  } = usePagination({ data: reservations, itemsPerPage: viewMode === "table" ? 20 : currentItemsPerPage })

  useEffect(() => {
    const savedViewMode = window.localStorage.getItem(RESERVATION_LIST_VIEW_MODE_STORAGE_KEY)
    if (savedViewMode === "table" || savedViewMode === "card") {
      setViewMode(savedViewMode)
    }
    setHasLoadedViewMode(true)
  }, [])

  useEffect(() => {
    if (!hasLoadedViewMode) return
    window.localStorage.setItem(RESERVATION_LIST_VIEW_MODE_STORAGE_KEY, viewMode)
  }, [hasLoadedViewMode, viewMode])

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current) {
        window.clearTimeout(copyResetTimeoutRef.current)
      }
    }
  }, [])

  const copyReservationInfo = async (reservation: ReservationWithRestaurant) => {
    const areaFirstWord = reservation.reservation_areas?.name?.split(' ')[0]
    const isMainHall = !areaFirstWord || areaFirstWord.toLowerCase() === 'main'
    const areaText = isMainHall ? '' : `${areaFirstWord} - `
    const reservationInfo = `${reservation.restaurants?.name || getTranslation("manage.reservations.card.unknownRestaurant")}\n${formatLocalizedDate(new Date(`${reservation.reservation_date}T12:00:00`), currentLang, {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    })}
${reservation.customer_name}
${reservation.party_size} ${getTranslation("manage.reservations.card.people")} - ${areaText}${reservation.reservation_type === 'drinks' ? getTranslation("manage.reservations.card.drinks") : getTranslation("manage.reservations.card.dining")}
${reservation.reservation_time.substring(0, 5)}
${reservation.customer_phone}${reservation.special_requests ? `\n${reservation.special_requests}` : ''}`

    setCopiedReservationId(reservation.id)
    if (copyResetTimeoutRef.current) {
      window.clearTimeout(copyResetTimeoutRef.current)
    }
    copyResetTimeoutRef.current = window.setTimeout(() => {
      setCopiedReservationId((current) => (current === reservation.id ? null : current))
    }, 1400)
    try {
      await navigator.clipboard.writeText(reservationInfo)
      toast.success(getTranslation("manage.reservations.card.copySuccess"))
    } catch {
      toast.error(getTranslation("manage.reservations.card.copyError"))
    }
  }

  const getBookedByDisplay = (reservation: ReservationWithRestaurant) => {
    const value = reservation.booked_by_name?.trim() || reservation.booked_by_label?.trim()
    if (value === "Staff") return getTranslation("manage.common.staff")
    if (value === "Administrator") return getTranslation("manage.common.administrator")
    return value || getTranslation("manage.seating.online")
  }

  const handleAction = async () => {
    if (!selectedReservation || !actionType) return

    setIsLoading(true)

    try {
      const status = actionType === "confirm" ? "confirmed" : "cancelled"
      await updateReservationStatus(selectedReservation.id, status, notes, sendEmail, emailLang)
      onRefresh()
    } catch (error) {
      console.error(`Error ${actionType}ing reservation:`, error)
    } finally {
      setIsLoading(false)
      setSelectedReservation(null)
      setActionType(null)
      setNotes("")
      setShowActionNotes(false)
      setSendEmail(true)
      setEmailLang('en')
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return (
          <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
            <Clock className="mr-1 h-3 w-3" />
            {getTranslation('common.status.pending')}
          </Badge>
        )
      case "confirmed":
        return (
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
            <CheckCircle className="mr-1 h-3 w-3" />
            {getTranslation('common.status.confirmed')}
          </Badge>
        )
      case "cancelled":
        return (
          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
            <XCircle className="mr-1 h-3 w-3" />
            {getTranslation('common.status.cancelled')}
          </Badge>
        )
      case "completed":
        return (
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
            {getTranslation('common.status.completed')}
          </Badge>
        )
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  const getCardBorderClass = (status: string) => {
    switch (status) {
      case "confirmed":
        return "border-l-green-500"
      case "cancelled":
        return "border-l-red-500"
      case "pending":
        return "border-l-yellow-500"
      case "completed":
        return "border-l-blue-500"
      default:
        return "border-l-blue-500"
    }
  }

  const renderCardView = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {paginatedData.map((reservation) => (
        <Card
          key={reservation.id}
          className={`hover:shadow-md transition-shadow border-l-4 ${getCardBorderClass(reservation.status || "pending")}`}
        >
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <CardTitle className="text-lg text-gray-900">{reservation.restaurants?.name || getTranslation("manage.reservations.card.unknownRestaurant")}</CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  {getStatusBadge(reservation.status || "pending")}
                  <ReservationUpdateIndicator summary={reservation.last_update_summary} compact />
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyReservationInfo(reservation)}
                  className={`h-10 w-10 sm:h-8 sm:w-8 p-0 transition-colors ${
                    copiedReservationId === reservation.id
                      ? "bg-green-50 text-green-700 hover:bg-green-100 hover:text-green-700"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                  title={getTranslation("manage.reservations.card.copyTooltip")}
                >
                  <Copy className="h-4 w-4" />
                </Button>
                {copiedReservationId === reservation.id && (
                  <div className="text-[10px] font-medium text-green-700 whitespace-nowrap">
                    {getTranslation("manage.reservations.card.copied")}
                  </div>
                )}
                <ReservationActionsMenu
                  onEdit={() => setEditingReservation(reservation)}
                  onConfirm={() => {
                    setSelectedReservation(reservation)
                    setActionType("confirm")
                  }}
                  onCancel={() => {
                    setSelectedReservation(reservation)
                    setActionType("cancel")
                  }}
                  confirmDisabled={reservation.status === "confirmed" || reservation.status === "cancelled"}
                  cancelDisabled={reservation.status === "cancelled"}
                  readOnly={readOnly}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Tarih ve Saat */}
            <div className="bg-gray-50 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                  <Calendar className="h-4 w-4 text-green-600" />
                </div>
                <div>
                  <div className="font-medium text-gray-900">
                    {formatLocalizedDate(new Date(`${reservation.reservation_date}T12:00:00`), currentLang, {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                      weekday: 'long'
                    })}
                  </div>
                  <div className="text-sm text-gray-600 flex items-center gap-1">
                     <Clock className="h-3 w-3" />
                     {reservation.reservation_time.substring(0, 5)}
                   </div>
                </div>
              </div>
            </div>
            
            {/* Müşteri Bilgileri */}
            <div className="bg-gray-50 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                  <User className="h-4 w-4 text-blue-600" />
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-gray-900">{reservation.customer_name}</div>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <span>{reservation.party_size} Kişi</span>
                    {reservation.reservation_areas?.name && (
                      <Badge variant="outline" className="bg-white text-xs">{reservation.reservation_areas.name}</Badge>
                    )}
                    <Badge variant={reservation.reservation_type === 'drinks' ? 'secondary' : 'default'} className="flex items-center gap-1 text-xs">
                      {reservation.reservation_type === 'drinks' ? (
                        <><Coffee className="h-2 w-2" /> {getTranslation('manage.reservations.card.drinks')}</>
                      ) : (
                        <><Utensils className="h-2 w-2" /> {getTranslation('manage.reservations.card.dining')}</>
                      )}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>
            
            {/* İletişim */}
            <div className="bg-gray-50 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
                  <Phone className="h-4 w-4 text-purple-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900">{reservation.customer_phone}</div>
                  <div className="text-sm text-gray-600 truncate">{reservation.customer_email}</div>
                </div>
              </div>
            </div>
            
            {/* Ek Bilgiler */}
            {(reservation.table_number || reservation.special_requests) && (
              <div className="border-t pt-3 space-y-2">
                {reservation.table_number && (
                  <div className="text-sm text-gray-600">
                    <span className="font-medium">{getTranslation('manage.reservations.card.table')}:</span> {reservation.table_number}
                  </div>
                )}
                {reservation.special_requests && (
                  <div className="text-sm text-gray-600">
                    <span className="font-medium">{getTranslation('manage.reservations.card.note')}:</span> {reservation.special_requests}
                  </div>
                )}
              </div>
            )}
            <ReservationUpdateIndicator summary={reservation.last_update_summary} />
          </CardContent>
          <CardFooter className="flex items-center justify-between gap-3 border-t pt-3">
            <div className="min-w-0 text-[10px] text-gray-500 leading-none text-left">
              {getTranslation("manage.reservations.card.createdBy")}:{" "}
              <span className="truncate">{getBookedByDisplay(reservation)}</span>
            </div>
            <div className="shrink-0 text-[10px] text-gray-500 leading-none text-right">
              {formatLocalizedDate(reservation.created_at, currentLang, {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
              })} {formatLocalizedTime(reservation.created_at, currentLang, {
                hour: '2-digit',
                minute: '2-digit'
              })}
            </div>
          </CardFooter>
        </Card>
      ))}
    </div>
  )

  const renderCompactTableList = () => (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
      {paginatedData.map((reservation) => (
        <article key={reservation.id} className={`rounded-xl border border-slate-200 border-l-4 bg-white p-3 pb-1.5 shadow-sm ${getCardBorderClass(reservation.status || "pending")}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1">
                <p className="truncate text-xs font-semibold text-slate-500">{reservation.restaurants?.name || getTranslation("manage.reservations.card.unknownRestaurant")}</p>
                <div className="origin-left scale-90">{getStatusBadge(reservation.status || "pending")}</div>
              </div>
            </div>
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyReservationInfo(reservation)}
                className={`h-7 w-7 p-0 ${copiedReservationId === reservation.id ? "text-emerald-600 hover:text-emerald-700" : "text-slate-500 hover:text-slate-700"}`}
                title={getTranslation("manage.reservations.card.copyTooltip")}
              >
                {copiedReservationId === reservation.id ? <CheckCircle className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
              <div className="[&>button]:h-7 [&>button]:w-7 [&>button]:p-0">
                <ReservationActionsMenu
                  onEdit={() => setEditingReservation(reservation)}
                  onConfirm={() => { setSelectedReservation(reservation); setActionType("confirm") }}
                  onCancel={() => { setSelectedReservation(reservation); setActionType("cancel") }}
                  confirmDisabled={reservation.status === "confirmed" || reservation.status === "cancelled"}
                  cancelDisabled={reservation.status === "cancelled"}
                  readOnly={readOnly}
                />
              </div>
            </div>
          </div>

          <div className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3">
            <div className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-center">
              <p className="text-base font-bold leading-none text-slate-900">{reservation.reservation_time.slice(0, 5)}</p>
              <p className="mt-1 text-[10px] font-medium text-slate-500">{formatLocalizedDate(new Date(`${reservation.reservation_date}T12:00:00`), currentLang)}</p>
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{reservation.customer_name}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
                <span>{reservation.party_size} {getTranslation("manage.reservations.card.people")}</span>
                <Badge variant={reservation.reservation_type === "drinks" ? "secondary" : "default"} className="h-5 gap-1 px-1.5 text-[10px]">
                  {reservation.reservation_type === "drinks" ? <Coffee className="h-2.5 w-2.5" /> : <Utensils className="h-2.5 w-2.5" />}
                  {reservation.reservation_type === "drinks" ? getTranslation("manage.reservations.card.drinks") : getTranslation("manage.reservations.card.dining")}
                </Badge>
                {reservation.reservation_areas?.name && <span className="truncate">{reservation.reservation_areas.name}</span>}
                {reservation.table_number && <span>Table {reservation.table_number}</span>}
              </div>
            </div>
          </div>

          {(reservation.customer_phone || reservation.customer_email || reservation.special_requests || reservation.last_update_summary || reservation.created_at) && (
            <div className={`relative mt-1 border-t border-slate-100 ${expandedDetailId === reservation.id ? "pt-3" : ""}`}>
              {expandedDetailId === reservation.id && (
                <div className="space-y-1.5 pb-2 pt-1 text-xs leading-5 text-slate-600">
                  {reservation.customer_phone && <p>{reservation.customer_phone}</p>}
                  {reservation.customer_email && <p className="break-all">{reservation.customer_email}</p>}
                  {reservation.special_requests && <p><span className="font-semibold text-slate-700">{getTranslation("manage.reservations.card.note")}: </span>{reservation.special_requests}</p>}
                  <ReservationUpdateIndicator summary={reservation.last_update_summary} compact showBadge={false} />
                </div>
              )}
              <button
                type="button"
                className="reservation-card-footer mt-1 flex h-6 w-full items-center justify-between px-2 text-slate-400 transition-colors hover:text-slate-700"
                onClick={() => setExpandedDetailId((current) => current === reservation.id ? null : reservation.id)}
                aria-expanded={expandedDetailId === reservation.id}
                aria-label={expandedDetailId === reservation.id ? "Hide reservation details" : "Show reservation details"}
              >
                <span className="flex min-w-0 items-center gap-1">
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expandedDetailId === reservation.id ? "rotate-180" : ""}`} />
                  <span className="flex min-w-0 items-center gap-1 text-[10px] font-medium text-slate-500">
                    <User className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span className="max-w-28 truncate">{getBookedByDisplay(reservation)}</span>
                  </span>
                  {reservation.last_update_summary && (
                    <span className="origin-left scale-75"><ReservationUpdateIndicator summary={reservation.last_update_summary} badgeOnly /></span>
                  )}
                </span>
                <span className="text-[8px] leading-none text-slate-400">
                  {new Date(reservation.created_at).toLocaleString(getTranslation("common.locale") || "en-US", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  })}
                </span>
              </button>
            </div>
          )}
        </article>
      ))}
    </div>
  )

  if (reservations.length === 0) {
    return (
      <div>
        {headerContent ? <div className="mb-4 flex items-center justify-between gap-3">{headerContent}</div> : null}
        <div className="relative isolate overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white via-slate-50 to-violet-50/70 px-6 py-12 text-center shadow-sm sm:px-8 sm:py-16 dark:border-white/10 dark:from-[#101116] dark:via-[#11131a] dark:to-violet-950/20">
          <div className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-violet-200/35 blur-3xl dark:bg-violet-500/10" />
          <div className="pointer-events-none absolute -bottom-24 -left-10 h-40 w-40 rounded-full bg-sky-200/25 blur-3xl dark:bg-sky-500/10" />
          <div className="relative mx-auto flex max-w-md flex-col items-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-100 text-violet-600 shadow-sm ring-8 ring-violet-50 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/5">
              <Calendar className="h-7 w-7" strokeWidth={1.7} aria-hidden="true" />
            </span>
            <p className="mt-6 text-[10px] font-bold uppercase tracking-[0.2em] text-violet-600/80 dark:text-violet-300/80">
              {getTranslation("manage.reservations.list.title")}
            </p>
            <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-950 dark:text-white">
              {emptyTitle || emptyMessage || getTranslation("manage.reservations.list.emptyTitle")}
            </h3>
            {(emptyDescription || !emptyMessage) && (
              <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500 dark:text-slate-400">
                {emptyDescription || getTranslation("manage.reservations.list.emptyDescription")}
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* View Toggle */}
      <div className="mb-4 flex items-center justify-between gap-3">
        {headerContent}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setViewMode((current) => current === "table" ? "card" : "table")}
          className="shrink-0 flex items-center gap-2"
          title={viewMode === "table" ? "Switch to cards" : "Switch to table"}
        >
          {viewMode === "table" ? <List className="h-4 w-4" /> : <Grid className="h-4 w-4" />}
          <span>{viewMode === "table" ? "Table" : "Cards"}</span>
        </Button>
      </div>

      {/* Table View */}
       {viewMode === "table" && renderCompactTableList()}
       {false && viewMode === "table" && (
         <div className="overflow-x-auto">
           <Table>
             <TableHeader>
               <TableRow>
                 <TableHead>{getTranslation("manage.reservations.card.restaurantHeader")}</TableHead>
                 <TableHead className="hidden md:table-cell">{getTranslation("manage.reservations.card.customer")}</TableHead>
                 <TableHead>{getTranslation("manage.reservations.card.dateTime")}</TableHead>
                 <TableHead className="hidden md:table-cell">{getTranslation("manage.reservations.card.area")}</TableHead>
                 <TableHead className="hidden sm:table-cell">{getTranslation("manage.reservations.card.partySize")}</TableHead>
                 <TableHead className="hidden lg:table-cell">{getTranslation("manage.reservations.card.type")}</TableHead>
                 <TableHead>{getTranslation("manage.reservations.card.status")}</TableHead>
                 <TableHead className="text-right">{getTranslation("manage.reservations.card.actions")}</TableHead>
               </TableRow>
             </TableHeader>
             <TableBody>
               {paginatedData.map((reservation) => (
                 <TableRow key={reservation.id}>
                   <TableCell className="font-medium">
                     <div>{reservation.restaurants?.name || getTranslation("manage.reservations.card.unknownRestaurant")}</div>
                     <div className="text-sm text-muted-foreground mt-1">
                       {reservation.customer_name}
                     </div>
                     {reservation.reservation_areas?.name && (
                       <div className="mt-1 md:hidden">
                         <Badge variant="secondary">{reservation.reservation_areas.name}</Badge>
                       </div>
                     )}
                     {reservation.table_number && (
                       <div className="text-xs text-muted-foreground">{getTranslation("manage.reservations.card.tableLabel")}: {reservation.table_number}</div>
                     )}
                     {reservation.special_requests && (
                       <div className="text-xs text-muted-foreground mt-1 italic">
                         {getTranslation("manage.reservations.card.note")}: {reservation.special_requests}
                       </div>
                     )}
                     <div className="mt-2">
                       <ReservationUpdateIndicator summary={reservation.last_update_summary} compact />
                     </div>
                   </TableCell>
                   <TableCell className="hidden md:table-cell">
                     <div className="font-medium">{getTranslation("manage.reservations.card.partySizeLabel")}: {reservation.party_size}</div>
                     <div className="text-sm text-muted-foreground">{reservation.customer_phone}</div>
                     <div className="text-sm text-muted-foreground flex items-center">
                       <Mail className="mr-1 h-3 w-3" />
                       {reservation.customer_email}
                     </div>
                   </TableCell>
                   <TableCell>
                     <div className="flex items-center">
                       <Calendar className="mr-2 h-4 w-4 text-muted-foreground" />
                       <span className="text-sm">{formatLocalizedDate(new Date(`${reservation.reservation_date}T12:00:00`), currentLang)}</span>
                     </div>
                     <div className="flex items-center text-sm text-muted-foreground">
                       <Clock className="mr-2 h-4 w-4" />
                       <span>{reservation.reservation_time.substring(0, 5)}</span>
                     </div>
                     <div className="sm:hidden text-xs text-muted-foreground mt-1">
                       Party: {reservation.party_size}
                     </div>
                   </TableCell>
                  <TableCell className="hidden md:table-cell">{reservation.reservation_areas?.name ? (
                    <Badge variant="outline">{reservation.reservation_areas.name}</Badge>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}</TableCell>
                   <TableCell className="hidden sm:table-cell">{reservation.party_size}</TableCell>
                   <TableCell className="hidden lg:table-cell">
                     <Badge variant={reservation.reservation_type === 'drinks' ? 'secondary' : 'default'} className="flex items-center gap-1 w-fit">
                       {reservation.reservation_type === 'drinks' ? (
                        <><Coffee className="h-3 w-3" /> {getTranslation("manage.reservations.card.drinks")}</>
                       ) : (
                        <><Utensils className="h-3 w-3" /> {getTranslation("manage.reservations.card.dining")}</>
                       )}
                     </Badge>
                   </TableCell>
                   <TableCell>
                     <div className="flex flex-col items-start gap-2">
                       {getStatusBadge(reservation.status || "pending")}
                       <ReservationUpdateIndicator summary={reservation.last_update_summary} compact />
                     </div>
                   </TableCell>
                   <TableCell className="text-right">
                     <ReservationActionsMenu
                       onEdit={() => setEditingReservation(reservation)}
                       onConfirm={() => {
                         setSelectedReservation(reservation)
                         setActionType("confirm")
                       }}
                       onCancel={() => {
                         setSelectedReservation(reservation)
                         setActionType("cancel")
                       }}
                       confirmDisabled={reservation.status === "confirmed" || reservation.status === "cancelled"}
                       cancelDisabled={reservation.status === "cancelled"}
                       readOnly={readOnly}
                     />
                   </TableCell>
                 </TableRow>
               ))}
             </TableBody>
           </Table>
         </div>
       )}

       {/* Card View */}
       {viewMode === "card" && renderCardView()}

      {/* Pagination Controls */}
      <div className="mt-4">
        <PaginationControls
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={goToPage}
          canGoNext={canGoNext}
          canGoPrevious={canGoPrevious}
          startIndex={startIndex}
          endIndex={endIndex}
          totalItems={totalItems}
          itemsPerPage={viewMode === "table" ? 20 : currentItemsPerPage}
          onItemsPerPageChange={setCurrentItemsPerPage}
          showItemsPerPage={viewMode !== "table"}
        />
      </div>

      {!readOnly && (
      <Dialog
        open={!!selectedReservation && !!actionType}
        onOpenChange={() => {
          setSelectedReservation(null)
          setActionType(null)
          setNotes("")
          setShowActionNotes(false)
          setSendEmail(true)
          setEmailLang('en')
        }}
      >
        <DialogContent className="max-h-[min(88dvh,680px)] min-h-[min(62dvh,520px)] w-[calc(100vw-1rem)] max-w-lg gap-0 overflow-hidden rounded-2xl border-slate-200 bg-white p-0 text-slate-950 shadow-2xl dark:border-[#2a3544] dark:bg-[#0f141c] dark:text-white sm:min-h-0">
          <div className={`shrink-0 border-b px-5 py-4 ${actionType === "cancel" ? "border-rose-200 bg-rose-50 dark:border-rose-400/30 dark:bg-[#2b1720]" : "border-emerald-200 bg-emerald-50 dark:border-emerald-400/30 dark:bg-[#12281f]"}`}>
            <DialogHeader className="text-left">
              <div className="flex items-center gap-2.5">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${actionType === "cancel" ? "bg-rose-100 text-rose-600 dark:bg-rose-400/15 dark:text-rose-200" : "bg-emerald-100 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-200"}`}>
                  {actionType === "cancel" ? <XCircle className="h-[18px] w-[18px]" /> : <CheckCircle className="h-[18px] w-[18px]" />}
                </div>
                <div className="min-w-0">
                  <DialogTitle className="truncate text-lg font-semibold leading-tight tracking-tight text-slate-950 dark:text-white">
                    {actionType === "confirm" ? getTranslation("manage.reservations.card.actionConfirm") : getTranslation("manage.reservations.card.actionCancel")}
                  </DialogTitle>
                  <DialogDescription className="mt-1 truncate text-sm text-slate-600 dark:text-slate-300">
                    {selectedReservation
                      ? `${selectedReservation.customer_name} · ${selectedReservation.restaurants?.name || getTranslation("manage.reservations.card.unknownRestaurant")}`
                      : getTranslation("manage.reservations.card.reviewDetails")}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
          </div>

          {selectedReservation && (
            <div className="min-h-0 overflow-y-auto px-5 py-4">
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 dark:border-[#2b3646] dark:bg-[#192230]">
                <div className="flex min-w-0 items-center gap-3 px-4 py-3">
                  <User className="h-[18px] w-[18px] shrink-0 text-slate-500 dark:text-slate-300" />
                  <p className="min-w-0 flex-1 truncate text-base font-semibold text-slate-950 dark:text-white">{selectedReservation.customer_name}</p>
                  <span className="max-w-32 shrink-0 truncate text-xs font-medium text-slate-600 dark:text-slate-300">
                    {selectedReservation.reservation_areas?.name || getTranslation("manage.reservationForm.mainHall")}
                  </span>
                </div>
                <div className="grid grid-cols-3 divide-x border-t border-slate-200 dark:divide-[#2b3646] dark:border-[#2b3646]">
                  <div className="min-w-0 px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{getTranslation("manage.reservations.card.date")}</p>
                    <p className="mt-1 truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {formatLocalizedDate(new Date(`${selectedReservation.reservation_date}T12:00:00`), currentLang, { weekday: "short", day: "numeric", month: "short" })}
                    </p>
                  </div>
                  <div className="min-w-0 px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{getTranslation("manage.reservations.card.time")}</p>
                    <p className="mt-1 truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {formatLocalizedTime(new Date(`${selectedReservation.reservation_date}T${selectedReservation.reservation_time}`), currentLang)}
                    </p>
                  </div>
                  <div className="min-w-0 px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{getTranslation("manage.reservations.card.partySizeLabel")}</p>
                    <p className="mt-1 truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {selectedReservation.party_size} {getTranslation("manage.reservations.card.people")}
                    </p>
                  </div>
                </div>
              </section>

              <section className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-[#2b3646] dark:bg-[#141b26]">
                <button
                  type="button"
                  className="flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-[#1b2634]"
                  aria-expanded={showActionNotes}
                  onClick={() => setShowActionNotes((visible) => !visible)}
                >
                  <ChevronDown className={`h-4 w-4 shrink-0 text-slate-600 transition-transform ${showActionNotes ? "rotate-180" : ""}`} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-950">
                    {showActionNotes ? getTranslation("manage.reservations.card.hideInternalNote") : getTranslation("manage.reservations.card.addInternalNote")}
                  </span>
                  <span className="shrink-0 text-xs text-slate-600">{getTranslation("manage.reservations.card.notesOptional")}</span>
                </button>
                {showActionNotes && (
                  <div className="border-t border-slate-200 p-3 dark:border-[#2b3646]">
                    <Label htmlFor="notes" className="sr-only">{getTranslation("manage.reservations.card.notesOptional")}</Label>
                    <Textarea
                      id="notes"
                      rows={2}
                      placeholder={getTranslation("manage.reservations.card.notesPlaceholderAction")}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="min-h-20 resize-none rounded-xl border-slate-200 bg-slate-50 text-sm dark:border-[#334155] dark:bg-[#0f1722] dark:text-slate-100 dark:placeholder:text-slate-500"
                    />
                  </div>
                )}
              </section>

              <div className="mt-3 flex min-h-12 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 dark:border-[#2b3646] dark:bg-[#141b26]">
                <Bell className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-300" />
                <Label htmlFor="sendEmail" className="min-w-0 flex-1 truncate text-sm font-medium text-slate-950">
                  {getTranslation("manage.reservations.card.sendEmail")}
                </Label>
                {sendEmail && (
                  <select
                    id="emailLang"
                    aria-label={getTranslation("manage.reservations.card.emailLanguage")}
                    className="h-9 w-[6.25rem] shrink-0 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs font-medium text-slate-950 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-500/20 dark:border-[#334155] dark:bg-[#0f1722]"
                    value={emailLang}
                    onChange={(e) => setEmailLang(e.target.value as 'en' | 'tr' | 'es')}
                  >
                    <option value="en">{getTranslation("manage.reservations.card.emailEnglish")}</option>
                    <option value="tr">{getTranslation("manage.reservations.card.emailTurkish")}</option>
                    <option value="es">{getTranslation("manage.reservations.card.emailSpanish")}</option>
                  </select>
                )}
                <Checkbox
                  id="sendEmail"
                  checked={sendEmail}
                  onCheckedChange={(checked) => setSendEmail(checked === true)}
                  className="h-5 w-5 shrink-0 rounded-md border-slate-300 data-[state=checked]:bg-sky-600 dark:border-slate-500 dark:data-[state=checked]:bg-sky-500"
                />
              </div>
            </div>
          )}

          <DialogFooter className="!flex-row gap-2 border-t border-slate-200 bg-white/95 p-4 backdrop-blur dark:border-[#2a3544] dark:bg-[#0f141c]/95">
            <Button
              variant="outline"
              onClick={() => {
                setSelectedReservation(null)
                setActionType(null)
                setNotes("")
                setShowActionNotes(false)
                setSendEmail(true)
              }}
              className="h-11 min-w-0 flex-1 whitespace-nowrap rounded-xl border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 dark:border-[#334155] dark:bg-[#141b26] dark:text-slate-100 dark:hover:bg-[#1b2634]"
            >
              {getTranslation("manage.reservations.list.cancel")}
            </Button>
            <Button
              variant={actionType === "confirm" ? "default" : "destructive"}
              onClick={handleAction}
              loading={isLoading}
              className="h-11 min-w-0 flex-1 whitespace-nowrap rounded-xl px-3 text-sm font-semibold"
            >
              {isLoading ? (
                actionType === "confirm" ? getTranslation("manage.reservations.card.confirming") : getTranslation("manage.reservations.card.cancelling")
              ) : actionType === "confirm" ? (
                getTranslation("manage.reservations.card.actionConfirm")
              ) : (
                getTranslation("manage.reservations.card.actionCancel")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      )}

      {!readOnly && editingReservation && (
        <ReservationForm
          isOpen={!!editingReservation}
          mode="edit"
          reservation={editingReservation}
          onClose={() => setEditingReservation(null)}
          onSuccess={() => {
            setEditingReservation(null)
            onRefresh()
          }}
        />
      )}
    </>
  )
}
