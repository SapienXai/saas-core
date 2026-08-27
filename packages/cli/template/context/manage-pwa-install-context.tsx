"use client"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useManageContext } from "@/context/manage-context"
import { getPwaInstallScope, getPwaInstalledScopeKey } from "@/lib/pwa-install"
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> }
type InstallOutcome = "accepted" | "dismissed" | null
type ProductWindow = Window & { __productBeforeInstallPrompt?: InstallPromptEvent | null }
let deferredInstallEvent: InstallPromptEvent | null = typeof window !== "undefined" ? (window as ProductWindow).__productBeforeInstallPrompt || null : null
const listeners = new Set<(event: InstallPromptEvent) => void>()
function isStandalone() { return typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)) }
function captureInstallPrompt(event: Event) { event.preventDefault(); if (isStandalone()) return; deferredInstallEvent = event as InstallPromptEvent; if (typeof window !== "undefined") (window as ProductWindow).__productBeforeInstallPrompt = deferredInstallEvent; listeners.forEach((listener) => listener(deferredInstallEvent!)) }
function clearDeferredInstallEvent() { deferredInstallEvent = null; if (typeof window !== "undefined") (window as ProductWindow).__productBeforeInstallPrompt = null }
if (typeof window !== "undefined") window.addEventListener("beforeinstallprompt", captureInstallPrompt)
const InstallContext = createContext<{ ready: boolean; installed: boolean; canInstall: boolean; installing: boolean; install: () => Promise<InstallOutcome> } | null>(null)
export function ManagePwaInstallProvider({ children }: { children: ReactNode }) {
  const { user, currentWorkspace } = useManageContext(); const [ready, setReady] = useState(false); const [installed, setInstalled] = useState(false); const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null); const [installing, setInstalling] = useState(false); const scope = getPwaInstallScope(user.id, currentWorkspace?.id); const previousScope = useRef<string | null>(null)
  useEffect(() => { if (previousScope.current !== null && previousScope.current !== scope) clearDeferredInstallEvent(); previousScope.current = scope; const sync = () => { const standalone = isStandalone(); const key = getPwaInstalledScopeKey(scope); const stored = Boolean(key && window.localStorage.getItem(key) === "1"); setInstalled(standalone || stored); if (standalone || stored) { clearDeferredInstallEvent(); setInstallEvent(null) } }; const onPrompt = (event: InstallPromptEvent) => { if (!isStandalone()) setInstallEvent(event) }; const onInstalled = () => { const key = getPwaInstalledScopeKey(scope); if (key) window.localStorage.setItem(key, "1"); setInstalled(true); clearDeferredInstallEvent(); setInstallEvent(null) }; listeners.add(onPrompt); window.addEventListener("appinstalled", onInstalled); window.addEventListener("pageshow", sync); document.addEventListener("visibilitychange", sync); sync(); setInstallEvent(deferredInstallEvent); setReady(true); return () => { listeners.delete(onPrompt); window.removeEventListener("appinstalled", onInstalled); window.removeEventListener("pageshow", sync); document.removeEventListener("visibilitychange", sync) } }, [scope])
  const install = useCallback(async () => { if (!installEvent || installed || isStandalone()) return null; setInstalling(true); try { await installEvent.prompt(); const choice = await installEvent.userChoice; if (choice.outcome === "accepted") { const key = getPwaInstalledScopeKey(scope); if (key) window.localStorage.setItem(key, "1"); setInstalled(true) }; clearDeferredInstallEvent(); setInstallEvent(null); return choice.outcome } finally { setInstalling(false) } }, [installEvent, installed, scope])
  const value = useMemo(() => ({ ready, installed, canInstall: Boolean(installEvent) && !installed, installing, install }), [install, installEvent, installed, installing, ready])
  return <InstallContext.Provider value={value}>{children}</InstallContext.Provider>
}
export function useManagePwaInstall() { const value = useContext(InstallContext); if (!value) throw new Error("useManagePwaInstall must be used within ManagePwaInstallProvider"); return value }
