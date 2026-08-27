"use client"

/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { Download, Smartphone, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useManageContext } from "@/context/manage-context"
import { useManagePwaInstall } from "@/context/manage-pwa-install-context"
import { useLanguage } from "@/context/language-context"
import { getPwaInstallPromptPreferenceKey } from "@/lib/pwa-install"

export type ManagementPwaBranding = {
  appName: string
  iconUrl: string
  themeColor: string
}

export function ManageAppInstallPrompt({ branding }: { branding: ManagementPwaBranding }) {
  const { getTranslation } = useLanguage()
  const t = getTranslation
  const { user, currentWorkspace, activeRestaurantId } = useManageContext()
  const { ready, installed, canInstall, installing, install } = useManagePwaInstall()
  const pathname = usePathname()
  const [hidden, setHidden] = useState(false)
  const [preferenceLoaded, setPreferenceLoaded] = useState(false)
  const preferenceKey = getPwaInstallPromptPreferenceKey(user.id, currentWorkspace?.id, activeRestaurantId)
  const isReservationsPage = pathname.startsWith("/manage/reservations")
  const promptPositionClass = isReservationsPage
    ? "bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-3 md:bottom-6 md:right-32"
    : "bottom-[calc(0.75rem+env(safe-area-inset-bottom))] right-3 md:bottom-6 md:right-6"
  const promptPanelPositionClass = isReservationsPage
    ? "bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-6 md:right-32"
    : "bottom-[calc(0.75rem+env(safe-area-inset-bottom))] md:bottom-6 md:right-6"

  useEffect(() => {
    setPreferenceLoaded(false)
    setHidden(false)

    if (!preferenceKey) {
      setPreferenceLoaded(true)
      return
    }

    try {
      setHidden(window.localStorage.getItem(preferenceKey) === "1")
    } catch {
      // Storage may be unavailable in privacy-restricted browser contexts.
    } finally {
      setPreferenceLoaded(true)
    }
  }, [preferenceKey])

  function dismiss() {
    setHidden(true)
    if (!preferenceKey) return

    try {
      window.localStorage.setItem(preferenceKey, "1")
    } catch {
      // Keep the in-memory fallback when storage is unavailable.
    }
  }

  function reopen() {
    setHidden(false)
    if (!preferenceKey) return

    try {
      window.localStorage.removeItem(preferenceKey)
    } catch {
      // Keep the in-memory fallback when storage is unavailable.
    }
  }

  if (!preferenceKey || !ready || installed || !preferenceLoaded) return null

  if (hidden) {
    return (
      <button
        type="button"
        onClick={reopen}
        className={`manage-app-install-prompt fixed ${promptPositionClass} z-40 inline-flex h-11 items-center gap-2 rounded-full border border-white/70 bg-white/95 px-3.5 text-xs font-bold text-slate-800 shadow-[0_12px_30px_rgba(15,23,42,0.18)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:shadow-[0_16px_34px_rgba(15,23,42,0.22)] dark:border-white/10 dark:bg-[#17181d]/95 dark:text-white`}
        aria-label={t("manage.pwa.installApp")}
      >
        <img src={branding.iconUrl} alt="" className="h-7 w-7 rounded-lg object-cover" />
        <span>{t("manage.pwa.installApp")}</span>
      </button>
    )
  }

  return (
    <aside
      className={`manage-app-install-prompt fixed inset-x-3 ${promptPanelPositionClass} z-40 overflow-hidden rounded-[20px] border border-white/70 bg-white/95 p-3 text-slate-950 shadow-[0_16px_46px_rgba(15,23,42,0.18)] backdrop-blur-xl animate-in slide-in-from-bottom-4 fade-in duration-300 dark:border-white/10 dark:bg-[#17181d]/95 dark:text-white md:inset-x-auto md:w-[340px]`}
      aria-label={t("manage.pwa.installAppTitle")}
    >
      <div className="pointer-events-none absolute -right-10 -top-12 h-28 w-28 rounded-full opacity-15 blur-2xl" style={{ backgroundColor: branding.themeColor }} />
      <button
        type="button"
        onClick={dismiss}
        className="absolute right-2.5 top-2.5 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white"
        aria-label={t("common.close")}
      >
        <X className="h-4 w-4" />
      </button>

      <div className="relative flex items-center gap-2.5 pr-7">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[14px] border border-white bg-white p-0.5 shadow-[0_6px_16px_rgba(15,23,42,0.12)] dark:border-white/15">
          <img src={branding.iconUrl} alt={`${branding.appName} logo`} className="h-full w-full rounded-[11px] object-cover" />
        </div>
        <div className="min-w-0">
          <div className="mb-0.5 flex items-center gap-1.5">
            <Smartphone className="h-3 w-3 text-violet-600 dark:text-violet-300" />
            <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-violet-600 dark:text-violet-300">{t("manage.pwa.title")}</span>
          </div>
          <h2 className="truncate text-sm font-bold tracking-tight">{t("manage.pwa.installApp")} {branding.appName}</h2>
          <p className="mt-0.5 text-[11px] leading-4 text-slate-500 dark:text-slate-400">{t("manage.pwa.workspaceManagement")}</p>
        </div>
      </div>

      <div className="relative mt-3 flex items-center gap-2">
        {canInstall ? (
          <Button type="button" onClick={() => void install()} loading={installing} className="h-9 flex-1 rounded-lg bg-slate-950 px-3 text-[11px] font-bold text-white shadow-[0_7px_16px_rgba(15,23,42,0.18)] hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200">
            <Download className="h-3.5 w-3.5" />
            {installing ? t("manage.pwa.installing") : t("manage.pwa.installApp")}
          </Button>
        ) : (
          <p className="flex-1 text-[10px] leading-4 text-slate-500 dark:text-slate-400">{t("manage.pwa.installMessageManual")}</p>
        )}
      </div>
    </aside>
  )
}
