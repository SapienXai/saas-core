"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { toast } from "sonner"
import { isManagementPwaOrigin } from "@/lib/pwa-origin"
import { useLanguage } from "@/context/language-context"

export type ManagePushNotificationStatus =
  | "checking"
  | "unsupported"
  | "unconfigured"
  | "ineligible"
  | "denied"
  | "enabled"
  | "disabled"
  | "loading"

type ManagePushNotificationsContextValue = {
  status: ManagePushNotificationStatus
  message: string | null
  enable: () => Promise<void>
  disable: () => Promise<void>
}

const ManagePushNotificationsContext = createContext<ManagePushNotificationsContextValue | null>(null)

function supportsPush() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
}

function toApplicationServerKey(rawPublicKey: string) {
  const publicKey = rawPublicKey.trim().replace(/^['"]|['"]$/g, "")
  const normalized = publicKey.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")

  try {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(padded)) throw new Error("invalid encoding")
    const decoded = atob(padded)
    if (decoded.length !== 65) throw new Error("invalid VAPID key length")
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
  } catch {
    throw new Error("Push notifications are temporarily unavailable. Please try again later.")
  }
}

export function ManagePushNotificationsProvider({ children }: { children: ReactNode }) {
  const { getTranslation } = useLanguage()
  const t = getTranslation
  const [status, setStatus] = useState<ManagePushNotificationStatus>("disabled")
  const [message, setMessage] = useState<string | null>(null)

  const checkEligibility = useCallback(async () => {
    if (!isManagementPwaOrigin(window.location.hostname)) {
      setStatus("unsupported")
      throw new Error(t("manage.push.originError"))
    }
    if (!supportsPush()) {
      setStatus("unsupported")
      throw new Error(t("manage.push.unsupportedError"))
    }
    if (Notification.permission === "denied") {
      setStatus("denied")
      throw new Error(t("manage.push.blockedError"))
    }

    const response = await fetch("/api/push-notifications/status", { cache: "no-store" })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || !data.eligible) {
      setStatus("ineligible")
      throw new Error(t("manage.push.planError"))
    }
    if (!data.configured) {
      setStatus("unconfigured")
      throw new Error(t("manage.push.unconfiguredError"))
    }
    return data as { eligible: true; configured: true; subscription: boolean }
  }, [t])

  useEffect(() => {
    let active = true
    setStatus("checking")
    setMessage(null)

    void checkEligibility()
      .then((eligibility) => {
        if (active) setStatus(eligibility.subscription ? "enabled" : "disabled")
      })
      .catch(() => {
        // checkEligibility owns the capability/plan status. A transient
        // status request failure should not surface a toast on page load.
      })

    return () => {
      active = false
    }
  }, [checkEligibility])

  const enable = useCallback(async () => {
    setStatus("checking")
    setMessage(null)
    try {
      const eligibility = await checkEligibility()

      const permission = await Notification.requestPermission()
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "disabled")
        return
      }

      const keyResponse = await fetch("/api/push-notifications/public-key", { cache: "no-store" })
      const keyPayload = await keyResponse.json().catch(() => ({}))
      if (!keyResponse.ok || !keyPayload.publicKey) throw new Error(t("manage.push.unconfiguredError"))

      const registration = await navigator.serviceWorker.register("/sw.js")
      const existing = await registration.pushManager.getSubscription()
      if (existing && eligibility.subscription) {
        setStatus("enabled")
        return
      }
      const subscription = existing || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: toApplicationServerKey(keyPayload.publicKey),
      })
      const response = await fetch("/api/push-notifications/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription),
      })
      await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(t("manage.push.genericError"))

      setStatus("enabled")
      toast.success(t("manage.push.enabledToast"))
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : t("manage.push.genericError")
      if (!["denied", "ineligible", "unconfigured", "unsupported"].includes(status)) setStatus("disabled")
      setMessage(nextMessage)
    }
  }, [checkEligibility, status, t])

  const disable = useCallback(async () => {
    setStatus("loading")
    setMessage(null)
    try {
      const registration = await navigator.serviceWorker.getRegistration("/sw.js")
      const subscription = await registration?.pushManager.getSubscription()
      if (subscription) {
        await fetch("/api/push-notifications/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        })
        await subscription.unsubscribe()
      }
      setStatus("disabled")
      toast.success(t("manage.push.disabledToast"))
    } catch {
      setStatus("enabled")
      setMessage(t("manage.push.disableError"))
    }
  }, [t])

  const value = useMemo(() => ({ status, message, enable, disable }), [disable, enable, message, status])

  return <ManagePushNotificationsContext.Provider value={value}>{children}</ManagePushNotificationsContext.Provider>
}

export function useManagePushNotifications() {
  const context = useContext(ManagePushNotificationsContext)
  if (!context) throw new Error("useManagePushNotifications must be used within ManagePushNotificationsProvider")
  return context
}
