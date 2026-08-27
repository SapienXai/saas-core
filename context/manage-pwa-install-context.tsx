"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { useManageContext } from "@/context/manage-context"
import { getPwaInstallScope, getPwaInstalledScopeKey } from "@/lib/pwa-install"

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

type InstallOutcome = "accepted" | "dismissed" | null
type InstallPromptListener = (event: InstallPromptEvent) => void
type PwaWindow = Window & {
  __reserveviaBeforeInstallPrompt?: InstallPromptEvent | null
}

let deferredInstallEvent: InstallPromptEvent | null = typeof window !== "undefined"
  ? (window as PwaWindow).__reserveviaBeforeInstallPrompt || null
  : null
const installPromptListeners = new Set<InstallPromptListener>()

function captureInstallPrompt(event: Event) {
  event.preventDefault()
  if (isStandalone()) {
    clearDeferredInstallEvent()
    return
  }
  const installEvent = event as InstallPromptEvent
  deferredInstallEvent = installEvent
  if (typeof window !== "undefined") (window as PwaWindow).__reserveviaBeforeInstallPrompt = installEvent
  installPromptListeners.forEach((listener) => listener(deferredInstallEvent as InstallPromptEvent))
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", captureInstallPrompt)
}

function subscribeToInstallPrompt(listener: InstallPromptListener) {
  installPromptListeners.add(listener)
  return () => installPromptListeners.delete(listener)
}

function clearDeferredInstallEvent() {
  deferredInstallEvent = null
  if (typeof window !== "undefined") (window as PwaWindow).__reserveviaBeforeInstallPrompt = null
}

const pwaLaunchTarget = typeof window !== "undefined"
  ? (() => {
      const params = new URLSearchParams(window.location.search)
      return params.get("pwa") === "1"
        ? { workspaceId: params.get("workspace"), restaurantId: params.get("restaurant") }
        : null
    })()
  : null

type ManagePwaInstallContextValue = {
  ready: boolean
  installed: boolean
  canInstall: boolean
  installing: boolean
  install: () => Promise<InstallOutcome>
}

const ManagePwaInstallContext = createContext<ManagePwaInstallContextValue | null>(null)

function isStandalone() {
  return typeof window !== "undefined" && (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  )
}

function hasStoredInstalledScope(
  scopes: Array<string | null | undefined>,
  workspaceId: string | null | undefined,
  restaurantId: string | null | undefined,
  standalone: boolean,
) {
  const storageKeys = scopes.map((scope) => getPwaInstalledScopeKey(scope)).filter((key): key is string => Boolean(key))
  if (!storageKeys.length) return false

  try {
    if (storageKeys.some((storageKey) => window.localStorage.getItem(storageKey) === "1")) return true

    const launchMatches = Boolean(
      standalone &&
      pwaLaunchTarget &&
      (!pwaLaunchTarget.workspaceId || pwaLaunchTarget.workspaceId === workspaceId) &&
      (!pwaLaunchTarget.restaurantId || pwaLaunchTarget.restaurantId === restaurantId),
    )
    if (launchMatches) {
      storageKeys.forEach((storageKey) => window.localStorage.setItem(storageKey, "1"))
      return true
    }
  } catch {
    return false
  }

  return false
}

function rememberInstalledScopes(scopes: Array<string | null | undefined>) {
  try {
    scopes
      .map((scope) => getPwaInstalledScopeKey(scope))
      .filter((key): key is string => Boolean(key))
      .forEach((storageKey) => window.localStorage.setItem(storageKey, "1"))
  } catch {
    // Storage may be unavailable in privacy-restricted browser contexts.
  }
}

function forgetInstalledScopes(scopes: Array<string | null | undefined>) {
  try {
    scopes
      .map((scope) => getPwaInstalledScopeKey(scope))
      .filter((key): key is string => Boolean(key))
      .forEach((storageKey) => window.localStorage.removeItem(storageKey))
  } catch {
    // Storage may be unavailable in privacy-restricted browser contexts.
  }
}

export function ManagePwaInstallProvider({ children }: { children: ReactNode }) {
  const { user, currentWorkspace, activeRestaurantId } = useManageContext()
  const [ready, setReady] = useState(false)
  const [installed, setInstalled] = useState(false)
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null)
  const [installing, setInstalling] = useState(false)
  const installScope = getPwaInstallScope(user.id, currentWorkspace?.id, activeRestaurantId)
  const workspaceInstallScope = getPwaInstallScope(user.id, currentWorkspace?.id, null)
  const previousInstallScope = useRef<string | null>(null)

  useEffect(() => {
    if (previousInstallScope.current !== null && previousInstallScope.current !== installScope) {
      clearDeferredInstallEvent()
    }
    previousInstallScope.current = installScope

    const handleInstallPrompt = (event: InstallPromptEvent) => {
      const standalone = isStandalone()
      if (standalone) return

      // Chrome does not clear our local marker when a user uninstalls the PWA.
      // A fresh beforeinstallprompt event is authoritative proof that this
      // browser can install the app again, so discard stale installed scopes.
      forgetInstalledScopes([installScope, workspaceInstallScope])
      setInstalled(false)
      setInstallEvent(event)
    }

    const media = window.matchMedia("(display-mode: standalone)")
    const syncDisplayMode = () => {
      const standalone = isStandalone()
      const alreadyInstalled = standalone || hasStoredInstalledScope([installScope, workspaceInstallScope], currentWorkspace?.id, activeRestaurantId, standalone)
      setInstalled(alreadyInstalled)
      if (alreadyInstalled) {
        clearDeferredInstallEvent()
        setInstallEvent(null)
      }
    }
    const handleAppInstalled = () => {
      setInstalled(true)
      rememberInstalledScopes([installScope, workspaceInstallScope])
      clearDeferredInstallEvent()
      setInstallEvent(null)
    }

    const unsubscribe = subscribeToInstallPrompt(handleInstallPrompt)
    const pendingInstallEvent = deferredInstallEvent
    if (pendingInstallEvent && !isStandalone()) {
      forgetInstalledScopes([installScope, workspaceInstallScope])
      setInstalled(false)
    }
    setInstallEvent(pendingInstallEvent)
    setReady(false)
    window.addEventListener("appinstalled", handleAppInstalled)
    window.addEventListener("pageshow", syncDisplayMode)
    document.addEventListener("visibilitychange", syncDisplayMode)
    syncDisplayMode()
    setReady(true)
    media.addEventListener?.("change", syncDisplayMode)

    return () => {
      unsubscribe()
      window.removeEventListener("appinstalled", handleAppInstalled)
      window.removeEventListener("pageshow", syncDisplayMode)
      document.removeEventListener("visibilitychange", syncDisplayMode)
      media.removeEventListener?.("change", syncDisplayMode)
    }
  }, [activeRestaurantId, currentWorkspace?.id, installScope, workspaceInstallScope])

  const install = useCallback(async (): Promise<InstallOutcome> => {
    if (!installEvent || installed || isStandalone()) return null

    setInstalling(true)
    try {
      await installEvent.prompt()
      const choice = await installEvent.userChoice
      if (choice.outcome === "accepted") {
        rememberInstalledScopes([installScope, workspaceInstallScope])
        setInstalled(true)
      }
      clearDeferredInstallEvent()
      setInstallEvent(null)
      return choice.outcome
    } finally {
      setInstalling(false)
    }
  }, [installEvent, installScope, installed, workspaceInstallScope])

  const value = useMemo(
    () => ({
      ready,
      installed,
      canInstall: Boolean(installEvent) && !installed,
      installing,
      install,
    }),
    [install, installEvent, installed, installing, ready]
  )

  return <ManagePwaInstallContext.Provider value={value}>{children}</ManagePwaInstallContext.Provider>
}

export function useManagePwaInstall() {
  const context = useContext(ManagePwaInstallContext)
  if (!context) throw new Error("useManagePwaInstall must be used within ManagePwaInstallProvider")
  return context
}
