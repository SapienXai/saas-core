"use client"

import type React from "react"
import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { ArrowDown, RefreshCw } from "lucide-react"
import { usePathname, useRouter } from "next/navigation"
import { useTheme } from "@/components/theme-provider"
import { ManageHeader } from "@/components/manage/manage-header"
import { ManageOfflineServiceWorker } from "@/components/manage/manage-offline-service-worker"
import { ManageSidebar } from "@/components/manage/manage-sidebar"
import { useManageContext } from "@/context/manage-context"
import { useLanguage } from "@/context/language-context"
import { ManagementPageLoading } from "@/components/ui/page-loading"
import { ManageAppInstallPrompt, type ManagementPwaBranding } from "@/components/manage/manage-app-install-prompt"
import { ManagePlanLimitNotice } from "@/components/manage/plan-limit-notice"
import { ReservationUsageNotice } from "@/components/manage/reservation-usage-notice"

type PullRefreshState = "idle" | "pulling" | "ready" | "refreshing"

const PULL_REFRESH_THRESHOLD = 76
const PULL_REFRESH_MAX_DISTANCE = 96
const PULL_REFRESH_MINIMUM_DURATION = 520

export function ManageShell({ children, initialBranding }: { children: React.ReactNode; initialBranding: ManagementPwaBranding }) {
  const branding = initialBranding
  const pathname = usePathname()
  const router = useRouter()
  const { user, loading, currentWorkspace } = useManageContext()
  const { getTranslation } = useLanguage()
  const { setTheme } = useTheme()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [manageDarkMode, setManageDarkMode] = useState(false)
  const [hasLoadedThemePreference, setHasLoadedThemePreference] = useState(false)
  const [pullDistance, setPullDistance] = useState(0)
  const [pullState, setPullState] = useState<PullRefreshState>("idle")
  const [isRefreshing, startRefresh] = useTransition()
  const mainRef = useRef<HTMLElement | null>(null)
  const hasLoadedThemePreferenceRef = useRef(false)
  const pullDistanceRef = useRef(0)
  const pullStateRef = useRef<PullRefreshState>("idle")
  const refreshStartedAtRef = useRef(0)

  const setManagedPullDistance = useCallback((nextDistance: number) => {
    pullDistanceRef.current = nextDistance
    setPullDistance(nextDistance)
  }, [])

  const setManagedPullState = useCallback((nextState: PullRefreshState) => {
    pullStateRef.current = nextState
    setPullState(nextState)
  }, [])

  const refreshManageData = useCallback(() => {
    if (pullStateRef.current === "refreshing") return
    refreshStartedAtRef.current = Date.now()
    setManagedPullState("refreshing")
    setManagedPullDistance(68)
    startRefresh(() => router.refresh())
  }, [router, setManagedPullDistance, setManagedPullState])

  useEffect(() => {
    // The public reservation experience remains light until it has its own
    // complete dark palette. Management owns its theme locally instead.
    setTheme("light")
    setManageDarkMode(window.localStorage.getItem("felix:manage:theme") === "dark")
    setSidebarCollapsed(window.localStorage.getItem("reservevia:manage:sidebar-collapsed") === "1")
    hasLoadedThemePreferenceRef.current = true
    setHasLoadedThemePreference(true)
  }, [setTheme])

  useEffect(() => {
    if (!hasLoadedThemePreferenceRef.current || !hasLoadedThemePreference) return
    window.localStorage.setItem("felix:manage:theme", manageDarkMode ? "dark" : "light")
  }, [hasLoadedThemePreference, manageDarkMode])

  useEffect(() => {
    // Selects and popovers are portalled to <body>, outside the .dark shell.
    // Expose the management theme there as well so their surfaces stay in sync.
    document.body.dataset.manageTheme = manageDarkMode ? "dark" : "light"

    return () => {
      delete document.body.dataset.manageTheme
    }
  }, [manageDarkMode])

  useEffect(() => {
    // The management shell owns the page scroll. Lock the document itself so
    // the browser cannot move the shell and sidebar while the main pane scrolls.
    const root = document.documentElement
    const body = document.body
    const hadRootLock = root.classList.contains("manage-document-lock")
    const hadBodyLock = body.classList.contains("manage-document-lock")
    root.classList.add("manage-document-lock")
    body.classList.add("manage-document-lock")

    return () => {
      if (!hadRootLock) root.classList.remove("manage-document-lock")
      if (!hadBodyLock) body.classList.remove("manage-document-lock")
    }
  }, [])

  useEffect(() => {
    if (pullState !== "refreshing" || isRefreshing) return

    const elapsed = Date.now() - refreshStartedAtRef.current
    const remaining = Math.max(PULL_REFRESH_MINIMUM_DURATION - elapsed, 0)
    const timeout = window.setTimeout(() => {
      setManagedPullDistance(0)
      setManagedPullState("idle")
    }, remaining)

    return () => window.clearTimeout(timeout)
  }, [isRefreshing, pullState, setManagedPullDistance, setManagedPullState])

  useEffect(() => {
    const main = mainRef.current
    if (!main) return

    let tracking = false
    let startX = 0
    let startY = 0

    const resetGesture = () => {
      tracking = false
      if (pullStateRef.current !== "refreshing") {
        setManagedPullDistance(0)
        setManagedPullState("idle")
      }
    }

    const isBlockedStart = (target: EventTarget | null) => {
      if (!target || !(target instanceof Element)) return false
      return Boolean(target.closest("input, textarea, select, button, a, [contenteditable=\"true\"], [data-no-pull-refresh], .overflow-x-auto"))
    }

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || pullStateRef.current === "refreshing" || main.scrollTop > 0 || isBlockedStart(event.target)) {
        return
      }

      tracking = true
      startX = event.touches[0].clientX
      startY = event.touches[0].clientY
    }

    const handleTouchMove = (event: TouchEvent) => {
      if (!tracking || pullStateRef.current === "refreshing" || event.touches.length !== 1) return

      const touch = event.touches[0]
      const deltaX = touch.clientX - startX
      const deltaY = touch.clientY - startY
      if (deltaY <= 0 || Math.abs(deltaY) <= Math.abs(deltaX) || main.scrollTop > 0) {
        resetGesture()
        return
      }

      if (event.cancelable) event.preventDefault()

      const distance = Math.min(PULL_REFRESH_MAX_DISTANCE, deltaY * 0.48)
      setManagedPullDistance(distance)
      setManagedPullState(distance >= PULL_REFRESH_THRESHOLD ? "ready" : "pulling")
    }

    const handleTouchEnd = () => {
      if (!tracking) return
      tracking = false

      if (pullDistanceRef.current >= PULL_REFRESH_THRESHOLD) {
        refreshManageData()
        return
      }

      setManagedPullDistance(0)
      setManagedPullState("idle")
    }

    main.addEventListener("touchstart", handleTouchStart, { passive: true })
    main.addEventListener("touchmove", handleTouchMove, { passive: false })
    main.addEventListener("touchend", handleTouchEnd, { passive: true })
    main.addEventListener("touchcancel", resetGesture, { passive: true })

    return () => {
      main.removeEventListener("touchstart", handleTouchStart)
      main.removeEventListener("touchmove", handleTouchMove)
      main.removeEventListener("touchend", handleTouchEnd)
      main.removeEventListener("touchcancel", resetGesture)
    }
  }, [currentWorkspace, loading, refreshManageData, setManagedPullDistance, setManagedPullState])

  const toggleSidebar = () => {
    if (window.matchMedia("(min-width: 768px)").matches) {
      setSidebarCollapsed((prev) => {
        const next = !prev
        window.localStorage.setItem("reservevia:manage:sidebar-collapsed", next ? "1" : "0")
        return next
      })
      return
    }

    setSidebarOpen((prev) => !prev)
  }

  if (loading && !currentWorkspace) {
    return <ManagementPageLoading label="Loading your workspace..." />
  }

  const pullProgress = Math.min(pullDistance / PULL_REFRESH_THRESHOLD, 1)
  const pullIndicatorLabel = pullState === "refreshing"
    ? getTranslation("manage.common.refreshing")
    : pullState === "ready"
      ? getTranslation("manage.common.releaseToRefresh")
      : getTranslation("manage.common.pullToRefresh")
  const pullIndicatorStyle: React.CSSProperties = {
    opacity: Math.min(pullDistance / 24, 1),
    transform: `translate3d(0, ${8 - pullProgress * 8}px, 0) scale(${0.88 + pullProgress * 0.12})`,
  }
  const shellStyle: React.CSSProperties = {
    transform: `translate3d(0, ${pullDistance}px, 0)`,
    transition: pullState === "pulling" || pullState === "ready" ? "none" : "transform 320ms cubic-bezier(0.22, 1, 0.36, 1)",
    willChange: pullDistance > 0 ? "transform" : undefined,
  }

  return (
    <div className={manageDarkMode ? "dark" : undefined}>
      <div className="relative isolate h-dvh w-full overflow-hidden bg-[#f6f7fb] dark:bg-[#050506]">
        {pullState !== "idle" && (
          <div className="manage-pull-refresh-layer" role="status" aria-live="polite">
            <div className="manage-pull-refresh-content" style={pullIndicatorStyle}>
              <span className={`manage-pull-refresh-icon${pullState === "ready" ? " is-ready" : ""}${pullState === "refreshing" ? " is-refreshing" : ""}`}>
                {pullState === "pulling" ? <ArrowDown aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
              </span>
              <span>{pullIndicatorLabel}</span>
            </div>
          </div>
        )}
        <div className="manage-shell relative z-10 isolate flex h-dvh min-h-0 w-full overflow-hidden overscroll-none bg-[#f6f7fb] text-slate-950 transition-colors dark:bg-[#050506] dark:text-white" style={shellStyle}>
          <ManageOfflineServiceWorker />
          <ManageSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} isCollapsed={sidebarCollapsed} isDark={manageDarkMode} onThemeChange={setManageDarkMode} toggleSidebar={toggleSidebar} />
          <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <ManageHeader user={user} toggleSidebar={toggleSidebar} />
            <main ref={mainRef} className="manage-main min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-3 pb-6 pt-3 md:px-6 md:pb-6 md:pt-5"><ManagePlanLimitNotice /><ReservationUsageNotice />{children}</main>
          </div>
        </div>
      </div>
      {!pathname.startsWith("/manage/pwa") && !pathname.startsWith("/manage/seating/print") && <ManageAppInstallPrompt branding={branding} />}
    </div>
  )
}
