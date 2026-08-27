"use client"

import React, { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { CardFooter } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { AlertTriangle, Bell, Calendar, CheckCircle, ChevronDown, Clock, Coffee, Copy, Grid, List, Mail, MessageSquare, Phone, User, Utensils, X, XCircle } from "lucide-react"
import type { Reservation } from "@/types/supabase"
import { updateReservationStatus, deleteReservation } from "@/app/manage/actions"
import { toast } from "sonner"
import { ReservationForm } from "@/components/manage/reservation-form"
import { ReservationActionsMenu } from "@/components/manage/reservation-actions-menu"
import { ReservationUpdateIndicator } from "@/components/manage/reservation-update-indicator"
import { usePagination } from "@/hooks/use-pagination"
import { PaginationControls } from "@/components/ui/pagination-controls"
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

interface ReservationListProps {
  reservations: ReservationWithRestaurant[]
  onStatusChange: () => void
  onReservationChange?: (change: ReservationMutationChange) => void
  itemsPerPage?: number
  restaurants?: { id: string; name: string; meal_only_reservations?: boolean }[]
  defaultRestaurantId?: string
  readOnly?: boolean
  eveningOnly?: boolean
  onEveningOnlyChange?: (enabled: boolean) => void
}

export type ReservationMutationChange = {
  type: "create" | "update" | "delete"
  reservation?: ReservationWithRestaurant | null
  previousReservation?: ReservationWithRestaurant | null
  reservationId?: string
  statsDirty?: boolean
}

const RESERVATION_LIST_VIEW_MODE_STORAGE_KEY = "felix-manage-reservation-list-view-mode"

export function ReservationList({
  reservations,
  onStatusChange,
  onReservationChange,
  itemsPerPage = 5,
  restaurants,
  defaultRestaurantId,
  readOnly = false,
  eveningOnly = false,
  onEveningOnlyChange,
}: ReservationListProps) {
  const { currentLang, getTranslation, translateMessage } = useLanguage()
  const [viewMode, setViewMode] = useState<"table" | "card">("card")
  const [hasLoadedViewMode, setHasLoadedViewMode] = useState(false)
  const [actionDialog, setActionDialog] = useState<{
    isOpen: boolean
    reservation: ReservationWithRestaurant | null
    action: "confirm" | "cancel" | null
  }>({ isOpen: false, reservation: null, action: null })
  const [deleteDialog, setDeleteDialog] = useState<{
    isOpen: boolean
    reservation: ReservationWithRestaurant | null
  }>({ isOpen: false, reservation: null })
  const [editForm, setEditForm] = useState<{
    isOpen: boolean
    reservation: ReservationWithRestaurant | null
  }>({ isOpen: false, reservation: null })
  const [notes, setNotes] = useState("")
  const [showActionNotes, setShowActionNotes] = useState(false)
  const [sendEmail, setSendEmail] = useState(true)
  const [emailLang, setEmailLang] = useState<'en' | 'tr' | 'es'>('en')
  const [loading, setLoading] = useState(false)
  const [currentItemsPerPage, setCurrentItemsPerPage] = useState(itemsPerPage)
  const [copiedReservationId, setCopiedReservationId] = useState<string | null>(null)
  const [expandedMobileNoteId, setExpandedMobileNoteId] = useState<string | null>(null)
  const copyResetTimeoutRef = useRef<number | null>(null)

  const effectiveItemsPerPage = viewMode === "table" ? 20 : currentItemsPerPage

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
  } = usePagination({ data: reservations, itemsPerPage: effectiveItemsPerPage })

  const closeActionDialog = () => {
    setActionDialog({ isOpen: false, reservation: null, action: null })
    setNotes("")
    setShowActionNotes(false)
    setSendEmail(true)
    setEmailLang("en")
  }

  const handleAction = async () => {
    if (!actionDialog.reservation || !actionDialog.action) return

    setLoading(true)
    try {
      const status = actionDialog.action === "confirm" ? "confirmed" : "cancelled"
      const result = await updateReservationStatus(
        actionDialog.reservation.id,
        status,
        notes,
        sendEmail,
        emailLang
      )

      if (result.success) {
        toast.success(translateMessage(result.message))
        if (onReservationChange) {
          onReservationChange({
            type: "update",
            reservation: (result as any).data || null,
            previousReservation: actionDialog.reservation,
            statsDirty: true,
          })
        } else {
          onStatusChange()
        }
        closeActionDialog()
      } else {
        toast.error(translateMessage(result.message))
      }
    } catch {
      toast.error(getTranslation("reserve.messages.unexpectedError"))
    } finally {
      setLoading(false)
    }
  }

  const openActionDialog = (reservation: ReservationWithRestaurant, action: "confirm" | "cancel") => {
    setActionDialog({ isOpen: true, reservation, action })
    setShowActionNotes(false)
  }

  const openDeleteDialog = (reservation: ReservationWithRestaurant) => {
    setDeleteDialog({ isOpen: true, reservation })
  }

  const handleDelete = async () => {
    if (!deleteDialog.reservation) return

    setLoading(true)
    try {
      const result = await deleteReservation(deleteDialog.reservation.id)

      if (result.success) {
        toast.success(getTranslation("manage.reservations.list.deleteSuccess"))
        if (onReservationChange) {
          onReservationChange({
            type: "delete",
            reservationId: deleteDialog.reservation.id,
            previousReservation: deleteDialog.reservation,
            statsDirty: true,
          })
        } else {
          onStatusChange()
        }
        setDeleteDialog({ isOpen: false, reservation: null })
      } else {
        toast.error(getTranslation("manage.reservations.list.deleteError"))
      }
    } catch {
      toast.error(getTranslation("manage.reservations.list.deleteError"))
    } finally {
      setLoading(false)
    }
  }

  const openEditForm = (reservation: ReservationWithRestaurant) => {
    setEditForm({ isOpen: true, reservation })
  }

  const closeEditForm = () => {
    setEditForm({ isOpen: false, reservation: null })
  }

  const handleEditSuccess = (updatedReservation?: any, previousReservation?: any) => {
    if (onReservationChange) {
      onReservationChange({
        type: "update",
        reservation: updatedReservation || null,
        previousReservation: previousReservation || editForm.reservation,
      })
    } else {
      onStatusChange()
    }
    closeEditForm()
  }

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
      toast.success(getTranslation('manage.reservations.card.copySuccess'))
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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "confirmed":
        return (
          <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700 dark:border-green-400/50 dark:bg-green-400/15 dark:text-green-300">
            <CheckCircle className="w-3 h-3 mr-1" />
            {getTranslation('common.status.confirmed')}
          </Badge>
        )
      case "cancelled":
        return (
          <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700 dark:border-red-400/50 dark:bg-red-400/15 dark:text-red-300">
            <XCircle className="w-3 h-3 mr-1" />
            {getTranslation('common.status.cancelled')}
          </Badge>
        )
      case "completed":
        return (
          <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/50 dark:bg-blue-400/15 dark:text-blue-300">
            <CheckCircle className="w-3 h-3 mr-1" />
            {getTranslation('common.status.completed')}
          </Badge>
        )
      default:
        return (
          <Badge variant="outline" className="border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-400/50 dark:bg-yellow-400/15 dark:text-yellow-300">
            <Clock className="w-3 h-3 mr-1" />
            {getTranslation('common.status.pending')}
          </Badge>
        )
    }
  }

  const getCardBorderClass = (status: string) => {
    switch (status) {
      case "confirmed":
        return "border-l-green-500 dark:border-l-green-400"
      case "cancelled":
        return "border-l-red-500 dark:border-l-red-400"
      case "pending":
        return "border-l-yellow-500 dark:border-l-yellow-400"
      case "completed":
        return "border-l-blue-500 dark:border-l-blue-400"
      default:
        return "border-l-blue-500 dark:border-l-blue-400"
    }
  }

  const isCancelAction = actionDialog.action === "cancel"

  const renderCardView = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {paginatedData.map((reservation) => (
        <Card
          key={reservation.id}
          className={`hover:shadow-md transition-shadow border-l-4 ${getCardBorderClass(reservation.status || "pending")}`}
        >
          <CardHeader className="pb-4">
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="min-w-0 flex-1 text-lg text-gray-900">{reservation.restaurants?.name || getTranslation("manage.reservations.card.unknownRestaurant")}</CardTitle>
                <div className="flex shrink-0 items-center gap-1">
                  <div className="flex items-center gap-1">
                   <Button
                     variant="ghost"
                     size="sm"
                     onClick={() => copyReservationInfo(reservation)}
                     className={`h-10 w-10 sm:h-8 sm:w-8 p-0 transition-colors ${
                       copiedReservationId === reservation.id
                         ? "bg-green-50 text-green-700 hover:bg-green-100 hover:text-green-700"
                         : "text-gray-500 hover:text-gray-700"
                     }`}
                     title={getTranslation('manage.reservations.card.copyTooltip')}
                   >
                     {copiedReservationId === reservation.id ? <CheckCircle className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                   </Button>
                   {copiedReservationId === reservation.id && (
                     <div className="text-[10px] font-medium text-green-700 whitespace-nowrap">
                       {getTranslation("manage.reservations.card.copied")}
                     </div>
                   )}
                  </div>
                  <ReservationActionsMenu
                    onEdit={() => openEditForm(reservation)}
                    onConfirm={() => openActionDialog(reservation, "confirm")}
                    onCancel={() => openActionDialog(reservation, "cancel")}
                    onDelete={() => openDeleteDialog(reservation)}
                    confirmDisabled={reservation.status === "confirmed" || reservation.status === "cancelled"}
                    cancelDisabled={reservation.status === "cancelled"}
                    showDelete
                    readOnly={readOnly}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  {getStatusBadge(reservation.status || "pending")}
                  <ReservationUpdateIndicator summary={reservation.last_update_summary} badgeOnly />
                </div>
                <ReservationUpdateIndicator summary={reservation.last_update_summary} compact showBadge={false} />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
             {/* Tarih ve Saat */}
             <div className="reservation-detail-panel bg-gray-50 rounded-lg p-3 space-y-2">
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
             <div className="reservation-detail-panel bg-gray-50 rounded-lg p-3 space-y-2">
               <div className="flex items-center gap-3">
                 <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                   <User className="h-4 w-4 text-blue-600" />
                 </div>
                 <div className="flex-1">
                   <div className="font-semibold text-gray-900">{reservation.customer_name}</div>
                   <div className="flex items-center gap-2 text-sm text-gray-600">
                     <span>{reservation.party_size} {getTranslation('manage.reservations.card.people')}</span>
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
            <div className="reservation-detail-panel bg-gray-50 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
                  <Phone className="h-4 w-4 text-purple-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900">{reservation.customer_phone}</div>
                  {reservation.customer_email && (
                    <div className="text-sm text-gray-600 truncate">{reservation.customer_email}</div>
                  )}
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
                <div className="origin-left scale-90">
                  {getStatusBadge(reservation.status || "pending")}
                </div>
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
                  onEdit={() => openEditForm(reservation)}
                  onConfirm={() => openActionDialog(reservation, "confirm")}
                  onCancel={() => openActionDialog(reservation, "cancel")}
                  onDelete={() => openDeleteDialog(reservation)}
                  confirmDisabled={reservation.status === "confirmed" || reservation.status === "cancelled"}
                  cancelDisabled={reservation.status === "cancelled"}
                  showDelete
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
                {reservation.table_number && <span>{getTranslation("manage.reservations.card.tableLabel")} {reservation.table_number}</span>}
              </div>
            </div>
          </div>

          {(reservation.customer_phone || reservation.customer_email || reservation.special_requests || reservation.last_update_summary || reservation.created_at) && (
            <div className={`relative mt-1 border-t border-slate-100 ${expandedMobileNoteId === reservation.id ? "pt-3" : ""}`}>
              {expandedMobileNoteId === reservation.id && (
                <div className="space-y-1.5 pb-2 pt-1 text-xs leading-5 text-slate-600">
                  {reservation.customer_phone && <p>{reservation.customer_phone}</p>}
                  {reservation.customer_email && <p className="break-all">{reservation.customer_email}</p>}
                  {reservation.special_requests && (
                    <p><span className="font-semibold text-slate-700">{getTranslation("manage.reservations.card.note")}: </span>{reservation.special_requests}</p>
                  )}
                  <ReservationUpdateIndicator summary={reservation.last_update_summary} compact showBadge={false} />
                </div>
              )}
              <button
                type="button"
                className="reservation-card-footer mt-1 flex h-6 w-full items-center justify-between px-2 text-slate-400 transition-colors hover:text-slate-700"
                onClick={() => setExpandedMobileNoteId((current) => current === reservation.id ? null : reservation.id)}
                aria-expanded={expandedMobileNoteId === reservation.id}
                aria-label={expandedMobileNoteId === reservation.id ? getTranslation("manage.reservations.card.hideDetails") : getTranslation("manage.reservations.card.showDetails")}
                title={expandedMobileNoteId === reservation.id ? getTranslation("manage.reservations.card.hideDetailsShort") : getTranslation("manage.reservations.card.showDetailsShort")}
              >
                <span className="flex min-w-0 items-center gap-1">
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expandedMobileNoteId === reservation.id ? "rotate-180" : ""}`} />
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

  return (
    <>
      {/* View Toggle */}
      <div className="mb-7 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setViewMode((current) => current === "table" ? "card" : "table")}
            className="h-9 min-w-[86px] justify-center gap-1.5 rounded-lg px-3 text-xs"
            title={viewMode === "table" ? getTranslation("manage.reservations.card.switchToCards") : getTranslation("manage.reservations.card.switchToTable")}
          >
            {viewMode === "table" ? <List className="h-4 w-4" /> : <Grid className="h-4 w-4" />}
            <span>{viewMode === "table" ? getTranslation("manage.reservations.card.tableView") : getTranslation("manage.reservations.card.cardsView")}</span>
          </Button>
          {onEveningOnlyChange && (
            <button
              type="button"
              onClick={() => onEveningOnlyChange(!eveningOnly)}
              aria-pressed={eveningOnly}
              aria-label={eveningOnly ? getTranslation("manage.reservations.card.showAllDay") : getTranslation("manage.reservations.card.showNightOnly")}
              className={`relative ml-0.5 h-9 w-[84px] shrink-0 overflow-hidden rounded-full border text-[10px] font-black tracking-[0.12em] transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#171820] ${
                eveningOnly
                  ? "border-violet-500 bg-violet-600 text-white shadow-md shadow-violet-500/30"
                  : "border-slate-300 bg-white text-slate-500 hover:border-violet-300 dark:border-white/20 dark:bg-white/[0.07] dark:text-slate-300"
              }`}
            >
              <span className={`absolute top-1/2 -translate-y-1/2 transition-all duration-200 ${eveningOnly ? "left-2.5" : "right-3"}`}>
                {eveningOnly ? getTranslation("manage.reservations.card.night") : getTranslation("manage.reservations.card.all")}
              </span>
              <span className={`evening-filter-thumb absolute top-1/2 h-7 w-7 -translate-y-1/2 rounded-full bg-white shadow-md transition-all duration-200 ${eveningOnly ? "right-1" : "left-1"}`} />
            </button>
          )}
        </div>
      </div>

      {/* Table View */}
      {viewMode === "table" && (
        <>
        {renderCompactTableList()}
        <div className="hidden overflow-x-auto rounded-md border">
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
                <React.Fragment key={reservation.id}>
                  <TableRow>
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
                      <div className="font-medium">{getTranslation("manage.reservations.card.partySize")}: {reservation.party_size}</div>
                      <div className="text-sm text-muted-foreground">{reservation.customer_phone}</div>
                      {reservation.customer_email && (
                        <div className="text-sm text-muted-foreground flex items-center">
                          <Mail className="mr-1 h-3 w-3" />
                          {reservation.customer_email}
                        </div>
                      )}
                      {(reservation.booked_by_name || reservation.booked_by_label || reservation.booked_by_email) && (
                        <div className="text-xs text-muted-foreground mt-1 truncate">
                          {getTranslation("manage.reservations.card.createdBy")}: {getBookedByDisplay(reservation)}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div>
                        <span>{formatLocalizedDate(new Date(`${reservation.reservation_date}T12:00:00`), currentLang)}</span>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        <span>{reservation.reservation_time.substring(0, 5)}</span>
                      </div>
                      <div className="sm:hidden text-xs text-muted-foreground mt-1">
                        {getTranslation("manage.reservations.card.partySize")}: {reservation.party_size}
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
                        onEdit={() => openEditForm(reservation)}
                        onConfirm={() => openActionDialog(reservation, "confirm")}
                        onCancel={() => openActionDialog(reservation, "cancel")}
                        onDelete={() => openDeleteDialog(reservation)}
                        confirmDisabled={reservation.status === "confirmed" || reservation.status === "cancelled"}
                        cancelDisabled={reservation.status === "cancelled"}
                        showDelete
                        readOnly={readOnly}
                      />
                    </TableCell>
                  </TableRow>
                 </React.Fragment>
               ))}
            </TableBody>
          </Table>
        </div>
        </>
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
          itemsPerPage={effectiveItemsPerPage}
          onItemsPerPageChange={setCurrentItemsPerPage}
          showItemsPerPage={viewMode !== "table"}
        />
      </div>

      {/* Action Dialog */}
      {!readOnly && (
      <Dialog
        open={actionDialog.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeActionDialog()
          }
        }}
      >
        <DialogContent className="!top-auto !bottom-0 !translate-y-0 flex min-h-[min(62dvh,520px)] max-h-[min(88dvh,680px)] w-[calc(100vw-1rem)] max-w-lg flex-col gap-0 overflow-hidden rounded-t-3xl border-slate-200 bg-white p-0 text-slate-950 shadow-2xl data-[state=open]:slide-in-from-bottom-full data-[state=closed]:slide-out-to-bottom-full sm:!top-[50%] sm:!bottom-auto sm:!translate-y-[-50%] sm:min-h-0 sm:max-h-[calc(100dvh-2rem)] sm:w-full sm:rounded-3xl sm:data-[state=open]:slide-in-from-top-[48%] sm:data-[state=closed]:slide-out-to-top-[48%] dark:border-[#2a3544] dark:bg-[#0f141c] dark:text-white">
          <div className={`shrink-0 border-b px-5 py-4 ${isCancelAction ? "border-rose-200 bg-rose-50 dark:border-rose-400/30 dark:bg-[#2b1720]" : "border-emerald-200 bg-emerald-50 dark:border-emerald-400/30 dark:bg-[#12281f]"}`}>
            <div className="flex items-center gap-2.5">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isCancelAction ? "bg-rose-100 text-rose-600 dark:bg-rose-400/15 dark:text-rose-200" : "bg-emerald-100 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-200"}`}>
                {isCancelAction ? <XCircle className="h-[18px] w-[18px]" /> : <CheckCircle className="h-[18px] w-[18px]" />}
              </div>
              <DialogHeader className="min-w-0 flex-1 space-y-0 text-left">
                <p className={`text-[10px] font-bold uppercase tracking-[0.15em] ${isCancelAction ? "text-rose-700 dark:text-rose-200" : "text-emerald-700 dark:text-emerald-200"}`}>
                  {getTranslation("manage.reservations.card.actionLabel")}
                </p>
                <DialogTitle className="truncate text-lg font-semibold leading-tight tracking-tight text-slate-950 dark:text-white">
                  {actionDialog.action === "confirm" ? getTranslation("manage.reservations.list.confirmReservation") : getTranslation("manage.reservations.list.cancelReservation")}
                </DialogTitle>
                <DialogDescription className="sr-only">
                  {isCancelAction ? getTranslation("manage.reservations.card.cancelDescription") : getTranslation("manage.reservations.card.confirmDescription")}
                </DialogDescription>
              </DialogHeader>
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={getTranslation("common.close")}
                  className="h-9 w-9 shrink-0 rounded-lg text-slate-500 hover:bg-black/5 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
                >
                  <X className="h-4 w-4" />
                </Button>
              </DialogClose>
            </div>
          </div>

          {actionDialog.reservation && (
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <section aria-labelledby="reservation-action-summary" className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 dark:border-[#2b3646] dark:bg-[#192230]">
                <div className="flex min-w-0 items-center gap-3 px-4 py-3">
                  <User className="h-[18px] w-[18px] shrink-0 text-slate-500 dark:text-slate-300" />
                  <div className="min-w-0 flex-1">
                    <p id="reservation-action-summary" className="truncate text-base font-semibold text-slate-950 dark:text-white">{actionDialog.reservation.customer_name}</p>
                    <p className="truncate text-xs text-slate-600 dark:text-slate-300">{actionDialog.reservation.restaurants?.name || getTranslation("manage.reservations.card.unknownRestaurant")}</p>
                  </div>
                  <span className="max-w-32 shrink-0 truncate text-xs font-medium text-slate-600 dark:text-slate-300">
                    {actionDialog.reservation.reservation_areas?.name || getTranslation("manage.reservationForm.mainHall")}
                  </span>
                </div>
                <div className="grid grid-cols-3 divide-x border-t border-slate-200 dark:divide-[#2b3646] dark:border-[#2b3646]">
                  <div className="min-w-0 px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{getTranslation("manage.reservations.card.date")}</p>
                    <p className="mt-1 truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {formatLocalizedDate(new Date(`${actionDialog.reservation.reservation_date}T12:00:00`), currentLang, { weekday: "short", day: "numeric", month: "short" })}
                    </p>
                  </div>
                  <div className="min-w-0 px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{getTranslation("manage.reservations.card.time")}</p>
                    <p className="mt-1 truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {formatLocalizedTime(new Date(`${actionDialog.reservation.reservation_date}T${actionDialog.reservation.reservation_time}`), currentLang)}
                    </p>
                  </div>
                  <div className="min-w-0 px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{getTranslation("manage.reservations.card.partySizeLabel")}</p>
                    <p className="mt-1 truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {actionDialog.reservation.party_size} {getTranslation("manage.reservations.card.people")}
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
                  <MessageSquare className="h-4 w-4 shrink-0 text-slate-600" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-950">
                    {showActionNotes ? getTranslation("manage.reservations.card.hideInternalNote") : getTranslation("manage.reservations.card.addInternalNote")}
                  </span>
                  <span className="shrink-0 text-xs text-slate-600">{getTranslation("manage.reservations.card.notesOptional")}</span>
                  <ChevronDown className={`h-4 w-4 shrink-0 text-slate-600 transition-transform ${showActionNotes ? "rotate-180" : ""}`} />
                </button>
                {showActionNotes && (
                  <div className="border-t border-slate-200 p-3 dark:border-[#2b3646]">
                    <Label htmlFor="reservation-action-notes" className="sr-only">{getTranslation("manage.reservations.card.notesOptional")}</Label>
                    <Textarea
                      id="reservation-action-notes"
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
                <Label htmlFor="reservation-action-send-email" className="min-w-0 flex-1 truncate text-sm font-medium text-slate-950">
                  {getTranslation("manage.reservations.card.guestNotification")}
                </Label>
                {sendEmail && (
                  <select
                    id="reservation-action-email-language"
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
                  id="reservation-action-send-email"
                  checked={sendEmail}
                  onCheckedChange={(checked) => setSendEmail(checked === true)}
                  className="h-5 w-5 shrink-0 rounded-md border-slate-300 data-[state=checked]:bg-sky-600 dark:border-slate-500 dark:data-[state=checked]:bg-sky-500"
                />
              </div>
            </div>
          )}

          <DialogFooter className="!flex-row gap-2 border-t border-slate-200 bg-white/95 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] backdrop-blur dark:border-[#2a3544] dark:bg-[#0f141c]/95">
            <Button
              variant="outline"
              onClick={closeActionDialog}
              className="h-11 min-w-0 flex-1 whitespace-nowrap rounded-xl border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 dark:border-[#334155] dark:bg-[#141b26] dark:text-slate-100 dark:hover:bg-[#1b2634]"
            >
              {getTranslation("manage.reservations.list.cancel")}
            </Button>
            <Button
              variant="default"
              onClick={handleAction}
              loading={loading}
              className={`h-11 min-w-0 flex-1 whitespace-nowrap rounded-xl px-3 text-sm font-semibold text-white shadow-sm ${isCancelAction ? "bg-rose-600 hover:bg-rose-500 dark:bg-rose-500 dark:hover:bg-rose-400" : "bg-emerald-600 hover:bg-emerald-500 dark:bg-emerald-500 dark:hover:bg-emerald-400"}`}
            >
              {loading
                ? getTranslation("manage.reservations.list.processing")
                : actionDialog.action === "confirm"
                ? getTranslation("manage.reservations.card.actionConfirm")
                : getTranslation("manage.reservations.card.actionCancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      )}

      {/* Delete Confirmation Dialog */}
      {!readOnly && (
      <Dialog
        open={deleteDialog.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteDialog({ isOpen: false, reservation: null })
          }
        }}
      >
        <DialogContent className="max-w-[calc(100vw-2rem)] gap-0 overflow-hidden rounded-2xl border-rose-100 p-0 sm:max-w-md">
          <div className="reservation-dialog-header bg-gradient-to-br from-rose-50 to-white px-5 pb-5 pt-6">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <DialogHeader className="space-y-1.5 text-left">
              <DialogTitle className="text-lg text-slate-900">{getTranslation("manage.reservations.list.deleteReservation")}</DialogTitle>
              <DialogDescription className="text-sm leading-5 text-slate-600">
                {getTranslation("manage.reservations.list.deleteConfirmation")}
              </DialogDescription>
            </DialogHeader>
          </div>
          {deleteDialog.reservation && (
            <div className="px-5 py-4">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm">
                <div className="col-span-2 min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{getTranslation("manage.reservations.card.customerLabel")}</p>
                  <p className="truncate font-semibold text-slate-800">{deleteDialog.reservation.customer_name}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{getTranslation("manage.reservations.card.restaurantHeader")}</p>
                  <p className="truncate font-medium text-slate-700">{deleteDialog.reservation.restaurants?.name || "-"}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{getTranslation("manage.reservations.card.dateTime")}</p>
                  <p className="font-medium text-slate-700">
                    {formatLocalizedDate(new Date(`${deleteDialog.reservation.reservation_date}T12:00:00`), currentLang)} · {deleteDialog.reservation.reservation_time.slice(0, 5)}
                  </p>
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="flex-row justify-end gap-2 border-t bg-slate-50 px-5 py-4 sm:space-x-0">
            <Button
              variant="outline"
              onClick={() => setDeleteDialog({ isOpen: false, reservation: null })}
            >
              {getTranslation("manage.reservations.list.cancel")}
            </Button>
            <Button
              variant="destructive"
              className="shadow-sm"
              onClick={handleDelete}
              loading={loading}
            >
              {loading ? getTranslation("manage.reservations.list.deleting") : getTranslation("manage.reservations.list.deleteReservation")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      )}

      {/* Edit Form */}
      {!readOnly && (
      <ReservationForm
        isOpen={editForm.isOpen}
        onClose={closeEditForm}
        onSuccess={handleEditSuccess}
        reservation={editForm.reservation}
        mode="edit"
        restaurants={restaurants}
        defaultRestaurantId={defaultRestaurantId}
      />
      )}
    </>
  )
}
