"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { CheckCircle, Edit, MoreHorizontal, Trash2, XCircle } from "lucide-react"
import { useLanguage } from "@/context/language-context"

interface ReservationActionsMenuProps {
  onEdit: () => void
  onConfirm: () => void
  onCancel: () => void
  onDelete?: () => void
  confirmDisabled?: boolean
  cancelDisabled?: boolean
  showDelete?: boolean
  readOnly?: boolean
}

export function ReservationActionsMenu({
  onEdit,
  onConfirm,
  onCancel,
  onDelete,
  confirmDisabled,
  cancelDisabled,
  showDelete = false,
  readOnly = false,
}: ReservationActionsMenuProps) {
  const { getTranslation } = useLanguage()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 639px)")
    const updateIsMobile = () => setIsMobile(mediaQuery.matches)

    updateIsMobile()
    mediaQuery.addEventListener("change", updateIsMobile)

    return () => {
      mediaQuery.removeEventListener("change", updateIsMobile)
    }
  }, [])

  const handleAction = (callback: () => void) => {
    setMobileOpen(false)
    callback()
  }

  const actionButtonClass = "h-14 w-full justify-start gap-3 rounded-2xl px-4 text-left text-sm font-semibold transition-all"

  const actionIconClass = "h-4 w-4 shrink-0"
  const triggerClassName = isMobile
    ? "h-10 w-10 p-0 text-gray-500 hover:text-gray-700"
    : "h-8 w-8 p-0 text-gray-500 hover:text-gray-700"

  if (readOnly) {
    return null
  }

  return (
    <>
      {isMobile ? (
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMobileOpen(true)}
            className={triggerClassName}
            aria-label={getTranslation("manage.reservations.actions.title")}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>

          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetContent side="bottom" className="max-h-[85vh] rounded-t-3xl px-4 pb-6 pt-4">
              <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-muted" />
              <SheetHeader className="text-left">
                <SheetTitle>{getTranslation("manage.reservations.actions.title")}</SheetTitle>
                <SheetDescription>{getTranslation("manage.reservations.actions.description")}</SheetDescription>
              </SheetHeader>

              <div className="mt-5 space-y-2.5">
                <Button
                  className={`${actionButtonClass} bg-slate-900 text-white shadow-sm hover:bg-slate-800 hover:shadow-md`}
                  onClick={() => handleAction(onEdit)}
                >
                  <Edit className={actionIconClass} />
                  {getTranslation("manage.reservations.list.editReservation")}
                </Button>
                {!confirmDisabled && (
                  <Button
                    variant="outline"
                    className={`${actionButtonClass} border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800`}
                    onClick={() => handleAction(onConfirm)}
                  >
                    <CheckCircle className={actionIconClass} />
                    {getTranslation("manage.reservations.list.confirmReservation")}
                  </Button>
                )}
                {!cancelDisabled && (
                  <Button
                    variant="outline"
                    className={`${actionButtonClass} border-rose-200 bg-white text-rose-700 hover:bg-rose-50 hover:text-rose-800`}
                    onClick={() => handleAction(onCancel)}
                  >
                    <XCircle className={actionIconClass} />
                    {getTranslation("manage.reservations.list.cancelReservation")}
                  </Button>
                )}
                {showDelete && onDelete && (
                  <div className="mt-1 border-t border-slate-200 pt-2">
                    <Button
                      variant="ghost"
                      className="h-11 w-full justify-start gap-3 rounded-xl px-4 text-left text-sm font-medium text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                      onClick={() => handleAction(onDelete)}
                    >
                      <Trash2 className={actionIconClass} />
                      {getTranslation("manage.reservations.list.deleteReservation")}
                    </Button>
                  </div>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className={triggerClassName}>
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">{getTranslation("manage.common.openMenu")}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={8} className="w-56">
            <DropdownMenuItem onClick={onEdit} className="text-blue-600">
              <Edit className="mr-2 h-4 w-4" />
              {getTranslation("manage.reservations.list.editReservation")}
            </DropdownMenuItem>
            {!confirmDisabled && (
              <DropdownMenuItem onClick={onConfirm} className="text-green-600">
                <CheckCircle className="mr-2 h-4 w-4" />
                {getTranslation("manage.reservations.list.confirmReservation")}
              </DropdownMenuItem>
            )}
            {!cancelDisabled && (
              <DropdownMenuItem onClick={onCancel} className="text-red-600">
                <XCircle className="mr-2 h-4 w-4" />
                {getTranslation("manage.reservations.list.cancelReservation")}
              </DropdownMenuItem>
            )}
            {showDelete && onDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onDelete} className="text-red-600">
                  <Trash2 className="mr-2 h-4 w-4" />
                  {getTranslation("manage.reservations.list.deleteReservation")}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  )
}
