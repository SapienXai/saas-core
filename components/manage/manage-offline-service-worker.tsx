"use client"

import { useEffect, useRef, useState } from "react"
import { isManagementPwaOrigin } from "@/lib/pwa-origin"
import { useLanguage } from "@/context/language-context"

function isSafeStaticAsset(url: string) {
  try {
    const parsed = new URL(url, window.location.origin)
    return parsed.origin === window.location.origin && (
      parsed.pathname.startsWith("/_next/static/") ||
      parsed.pathname.startsWith("/assets/") ||
      parsed.pathname.startsWith("/icon-") ||
      parsed.pathname === "/apple-touch-icon.png" ||
      parsed.pathname === "/favicon.ico" ||
      parsed.pathname === "/favicon.png"
    )
  } catch {
    return false
  }
}

function collectStaticAssetUrls() {
  const urls = new Set<string>()
  document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>("script[src],link[href]").forEach((element) => {
    const url = "src" in element ? element.src : element.href
    if (url && isSafeStaticAsset(url)) urls.add(url)
  })
  performance.getEntriesByType("resource").forEach((entry) => {
    if (isSafeStaticAsset(entry.name)) urls.add(entry.name)
  })
  return Array.from(urls)
}

function postStaticAssetCache(registration: ServiceWorkerRegistration) {
  const worker = registration.active || registration.waiting || registration.installing
  const urls = collectStaticAssetUrls()
  if (worker && urls.length > 0) worker.postMessage({ type: "CACHE_STATIC_URLS", urls })
}

async function ensureServiceWorkerControlsPage() {
  const reloadKey = "saas-core:manage:sw-control-reloaded"
  const clearReloadMarker = () => {
    try { window.sessionStorage.removeItem(reloadKey) } catch {}
  }

  if (navigator.serviceWorker.controller) {
    clearReloadMarker()
    return
  }

  try {
    await navigator.serviceWorker.ready
  } catch {
    // The browser can reject readiness when service workers are disabled.
  }

  if (navigator.serviceWorker.controller) {
    clearReloadMarker()
    return
  }

  try {
    if (!window.sessionStorage.getItem(reloadKey)) {
      window.sessionStorage.setItem(reloadKey, "1")
      window.location.reload()
    }
  } catch {
    // Ignore storage restrictions; the next navigation can retry.
  }
}

export function ManageOfflineServiceWorker() {
  const { getTranslation } = useLanguage()
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const waitingWorker = useRef<ServiceWorker | null>(null)
  const userRequestedUpdateRef = useRef(false)

  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production" || !isManagementPwaOrigin(window.location.hostname)) return
    let cancelled = false
    const onControllerChange = () => {
      if (userRequestedUpdateRef.current) window.location.reload()
    }
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "SAAS_CORE_SW_ACTIVATED") setUpdateAvailable(false)
    }

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange)
    navigator.serviceWorker.addEventListener("message", onMessage)
    fetch("/sw.js", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`ServiceWorker script returned ${response.status}`)
        return navigator.serviceWorker.register("/sw.js")
      })
      .then((registration) => {
        if (cancelled) return
        if (registration.waiting && navigator.serviceWorker.controller) {
          waitingWorker.current = registration.waiting
          setUpdateAvailable(true)
        }
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              waitingWorker.current = worker
              setUpdateAvailable(true)
            }
          })
        })
        void registration.update()
        postStaticAssetCache(registration)

        // Chrome evaluates the service-worker installability requirement on
        // the next document. Wait until the worker is active before doing a
        // single controlled reload on a first visit.
        void ensureServiceWorkerControlsPage()
      })
      .catch((error) => console.warn("Failed to register the management service worker:", error))

    return () => {
      cancelled = true
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange)
      navigator.serviceWorker.removeEventListener("message", onMessage)
    }
  }, [])

  if (!updateAvailable) return null
  return <button type="button" className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white shadow-xl" onClick={() => {
    userRequestedUpdateRef.current = true
    waitingWorker.current?.postMessage({ type: "SKIP_WAITING" })
  }}>{getTranslation("common.updateAvailable")}</button>
}
