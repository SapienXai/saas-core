"use client"

import Link from "next/link"
import { ArrowRight, Check, Crown, Store, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useLanguage } from "@/context/language-context"
import { getPlanNavigationHref } from "@/lib/plan-navigation"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentPlan: string
  restaurantCount: number
  restaurantLimit: number | null
  reason: "restaurant_limit" | "multi_restaurant" | null
  currentWorkspaceId?: string | null
  ownedWorkspaceId?: string | null
}

export function RestaurantUpgradeModal({ open, onOpenChange, currentPlan, restaurantCount, restaurantLimit, reason, currentWorkspaceId, ownedWorkspaceId }: Props) {
  const { getTranslation } = useLanguage()
  const planHref = getPlanNavigationHref({ currentWorkspaceId, ownedWorkspaceId })
  const limitLabel = restaurantLimit === null
    ? getTranslation("manage.restaurants.upgrade.unlimitedRestaurants")
    : getTranslation(restaurantLimit === 1 ? "manage.restaurants.upgrade.restaurantSlot" : "manage.restaurants.upgrade.restaurantSlots", { count: restaurantCount, limit: restaurantLimit })
  const limitReached = reason === "restaurant_limit"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-xl overflow-hidden rounded-[2rem] border border-white/70 bg-[#faf8f4] p-0 text-slate-950 shadow-2xl shadow-slate-950/25">
        <div className="relative overflow-hidden bg-slate-950 px-6 pb-7 pt-6 text-white sm:px-8 sm:pt-8">
          <div className="absolute -right-14 -top-20 h-56 w-56 rounded-full bg-violet-500/30 blur-3xl" />
          <div className="absolute -bottom-24 left-20 h-40 w-40 rounded-full bg-amber-300/20 blur-3xl" />
          <DialogClose className="absolute right-4 top-4 rounded-full p-2 text-white/60 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/50" aria-label={getTranslation("manage.restaurants.upgrade.closeDialog")}>
            <X className="h-4 w-4" />
          </DialogClose>
          <DialogHeader className="relative text-left">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-amber-300">
              <Crown className="h-4 w-4" />
              {getTranslation("manage.restaurants.upgrade.unlockMore")}
            </div>
            <DialogTitle className="mt-4 max-w-md text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              {limitReached ? getTranslation("manage.restaurants.upgrade.slotsUsed") : getTranslation("manage.restaurants.upgrade.addAnother")}
            </DialogTitle>
            <DialogDescription className="mt-3 max-w-md text-sm leading-6 text-slate-300">
              {limitReached
                ? getTranslation("manage.restaurants.upgrade.currentPlanIncludes", { plan: currentPlan, limit: limitLabel })
                : getTranslation("manage.restaurants.upgrade.multipleNotIncluded", { plan: currentPlan })}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="space-y-4 px-6 py-6 sm:px-8 sm:py-7">
          <div className="rounded-2xl border border-violet-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
                <Store className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-slate-950">{getTranslation("manage.restaurants.upgrade.feature")}</p>
                  <span className="rounded-full bg-violet-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-violet-700">{getTranslation("manage.restaurants.upgrade.planName")}</span>
                </div>
                <p className="mt-1 text-sm text-slate-500">{getTranslation("manage.restaurants.upgrade.currentPlanLimit", { limit: limitLabel })}</p>
              </div>
            </div>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              {[
                getTranslation("manage.restaurants.upgrade.separatePages"),
                getTranslation("manage.restaurants.upgrade.sharedWorkspace"),
                getTranslation("manage.restaurants.upgrade.sharedPermissions"),
                getTranslation("manage.restaurants.upgrade.restaurantManagement"),
              ].map((benefit) => (
                <div key={benefit} className="flex items-start gap-2 text-sm text-slate-600">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <span>{benefit}</span>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between sm:space-x-0">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="h-11 rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900">
              {getTranslation("manage.restaurants.upgrade.maybeLater")}
            </Button>
            <Button asChild className="h-11 rounded-xl bg-slate-950 px-5 text-white shadow-lg shadow-slate-950/15 hover:bg-slate-800">
              <Link href={planHref}>
                {getTranslation("manage.restaurants.upgrade.viewOptions")}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
