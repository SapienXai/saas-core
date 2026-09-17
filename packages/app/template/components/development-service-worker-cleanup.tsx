"use client"

import { useEffect } from "react"
import { isLocalDevelopmentHostname } from "@/lib/domains/hostname"

const LOCAL_CACHE_PREFIXES = ["saas-core-manage-", "manage-offline-"]

function isLocalDevelopment() {
  return process.env.NODE_ENV !== "production" && isLocalDevelopmentHostname(window.location.hostname)
}

export function DevelopmentServiceWorkerCleanup() {
  useEffect(() => {
    if (!isLocalDevelopment() || !("serviceWorker" in navigator)) return

    let cancelled = false

    void (async () => {
      const registrations = await navigator.serviceWorker.getRegistrations()
      const hadController = Boolean(navigator.serviceWorker.controller)

      await Promise.all(registrations.map((registration) => registration.unregister()))

      if ("caches" in window) {
        const cacheNames = await window.caches.keys()
        await Promise.all(
          cacheNames
            .filter((name) => LOCAL_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix)))
            .map((name) => window.caches.delete(name)),
        )
      }

      if (!cancelled && (registrations.length > 0 || hadController) && hadController) {
        window.location.reload()
      }
    })().catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [])

  return null
}
