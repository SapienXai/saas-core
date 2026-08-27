"use client"

import type React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect } from "react"
import { ManageProvider } from "@/context/manage-context"
import { ManagePwaInstallProvider } from "@/context/manage-pwa-install-context"
import { ManagePushNotificationsProvider } from "@/context/manage-push-notifications-context"
import { ManageShell } from "@/components/manage/manage-shell"
import type { ManageInitialContext } from "@/context/manage-context"
import { selectRestaurant, selectWorkspace } from "@/app/manage/context-actions"
import { startNavigationFeedback } from "@/components/navigation-feedback"
import type { ManagementPwaBranding } from "@/components/manage/manage-app-install-prompt"

export function ManageLayoutClient({ children, initialBranding, initialContext }: { children: React.ReactNode; initialBranding: ManagementPwaBranding; initialContext: ManageInitialContext | null }) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const isLoginPage =
    pathname === "/manage/login" || pathname === "/manage/reset-password" || pathname === "/manage/update-password"
  const isPrintPage = pathname.startsWith("/manage/seating/print")

  useEffect(() => {
    const requestedWorkspace = searchParams.get("workspace")
    const requestedRestaurant = searchParams.get("restaurant")
    if ((!requestedWorkspace && !requestedRestaurant) || isLoginPage || isPrintPage) return
    let active = true
    void (async () => {
      if (requestedWorkspace) await selectWorkspace(requestedWorkspace)
      if (requestedRestaurant) await selectRestaurant(requestedRestaurant)
      if (!active) return
      const nextParams = new URLSearchParams(searchParams.toString())
      nextParams.delete("workspace")
      nextParams.delete("restaurant")
      nextParams.delete("pwa")
      const query = nextParams.toString()
      startNavigationFeedback()
      router.replace(query ? `${pathname}?${query}` : pathname)
      router.refresh()
    })().catch(() => undefined)
    return () => { active = false }
  }, [isLoginPage, isPrintPage, pathname, router, searchParams])

  if (isLoginPage || isPrintPage) {
    return <>{children}</>
  }

  return (
    <ManageProvider initialContext={initialContext}>
      <ManagePushNotificationsProvider>
        <ManagePwaInstallProvider>
          <ManageShell initialBranding={initialBranding}>{children}</ManageShell>
        </ManagePwaInstallProvider>
      </ManagePushNotificationsProvider>
    </ManageProvider>
  )
}
