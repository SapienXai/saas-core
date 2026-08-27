"use client"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Bell, Menu, Wifi, WifiOff, X } from "lucide-react"
import { usePathname, useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { OrbLoader } from "@/components/ui/orb-loader"
import { useManageContext } from "@/context/manage-context"
import { useManagePushNotifications } from "@/context/manage-push-notifications-context"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import { PRODUCT_CONFIG } from "@/lib/product-config"

export function ManageHeader({ user, toggleSidebar }: { user: { id: string; email: string; name: string }; toggleSidebar: () => void }) {
  const pathname = usePathname(); const router = useRouter(); const { currentWorkspace } = useManageContext(); useManagePushNotifications(); const [isOnline, setIsOnline] = useState(true); const [showNotifications, setShowNotifications] = useState(false); const [isSigningOut, setIsSigningOut] = useState(false)
  useEffect(() => { const update = () => setIsOnline(navigator.onLine); update(); window.addEventListener("online", update); window.addEventListener("offline", update); return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update) } }, [])
  const pageTitle = useMemo(() => pathname === "/app" || pathname === "/manage" ? "Workspace" : pathname.includes("/team") ? "Team" : pathname.includes("/plan") ? "Plan & usage" : pathname.includes("/domains") ? "Domains" : pathname.includes("/pwa") ? "Management app" : pathname.includes("/settings") ? "Settings" : pathname.includes("/platform") ? "Platform" : PRODUCT_CONFIG.name, [pathname])
  useEffect(() => { document.title = `${pageTitle} | ${PRODUCT_CONFIG.name}` }, [pageTitle])
  const handleSignOut = useCallback(async () => {
    setIsSigningOut(true)
    try { await getSupabaseBrowserClient().auth.signOut({ scope: "local" }) } catch (error) { console.warn("Sign out failed:", error) }
    window.location.replace("/auth/signout")
  }, [])
  useEffect(() => { const signOutFromSidebar = () => void handleSignOut(); window.addEventListener("saas-core-manage-sign-out", signOutFromSidebar); return () => window.removeEventListener("saas-core-manage-sign-out", signOutFromSidebar) }, [handleSignOut])
  return <>
    {isSigningOut && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/25 backdrop-blur-sm" role="status" aria-live="polite"><OrbLoader label="Signing out" theme="dark" state="working" /></div>}
    <header className="sticky top-0 z-30 shrink-0 border-b border-slate-200/80 bg-white/85 backdrop-blur-xl transition-colors dark:border-white/10 dark:bg-[#0b0c0f]/85">
      <div className="flex h-14 items-center justify-between px-3 sm:h-16 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon" onClick={toggleSidebar} className="mr-1 rounded-xl hover:bg-slate-100 dark:hover:bg-white/10 md:hidden" aria-label="Open navigation"><Menu className="h-5 w-5" /></Button>
          <button type="button" onClick={() => router.push("/app")} className="min-w-0 text-left transition-opacity hover:opacity-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500" aria-label="Open workspace">
            <div className="flex min-w-0 items-center gap-1.5"><p className="min-w-0 truncate text-[8px] font-bold uppercase leading-none tracking-[0.14em] text-slate-400 sm:text-[9px]">{currentWorkspace?.workspace?.name || "Workspace"}</p>{currentWorkspace?.plan?.name && <span className="inline-flex h-4 items-center rounded-md border border-violet-200 bg-violet-50 px-1.5 text-[8px] font-bold uppercase tracking-[0.08em] text-violet-700">{currentWorkspace.plan.name}</span>}</div>
            <h1 className="mt-0.5 truncate text-base font-bold leading-none tracking-tight text-slate-950 dark:text-white sm:text-lg">{pageTitle}</h1>
          </button>
          <Badge variant="outline" className={`ml-2 hidden h-6 gap-1 rounded-full px-2 text-[10px] font-bold uppercase sm:inline-flex ${isOnline ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>{isOnline ? <Wifi className="h-2.5 w-2.5" /> : <WifiOff className="h-2.5 w-2.5" />}{isOnline ? "Online" : "Offline"}</Badge>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="relative"><Button variant="ghost" size="icon" onClick={() => setShowNotifications((value) => !value)} className={`relative h-11 w-11 rounded-full border border-transparent sm:h-10 sm:w-10 ${showNotifications ? "border-slate-200 bg-slate-950 text-white" : "hover:border-slate-200 hover:bg-slate-100"}`} aria-label="Notifications" title="Notifications"><Bell className="h-5 w-5" /></Button>{showNotifications && <Card className="absolute right-0 top-full z-50 mt-2 w-[min(calc(100vw-1.5rem),22rem)] overflow-hidden rounded-2xl border-slate-200 shadow-xl"><div className="flex items-start justify-between bg-slate-950 px-4 py-3 text-white"><div><h2 className="text-sm font-semibold">Notifications</h2><p className="mt-0.5 text-[11px] text-white/60">Workspace updates will appear here.</p></div><Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg text-white/70 hover:bg-white/10 hover:text-white" onClick={() => setShowNotifications(false)} aria-label="Close notifications"><X className="h-4 w-4" /></Button></div><CardContent className="p-5 text-center"><div className="mx-auto flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-400"><Bell className="h-4 w-4" /></div><p className="mt-2 text-xs font-medium text-slate-700">No new notifications</p></CardContent></Card>}</div>
          <div className="hidden items-center gap-2 border-l border-slate-200 pl-3 dark:border-white/10 sm:flex"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700">{(user.name || user.email || "A").slice(0, 1).toUpperCase()}</div><button type="button" onClick={() => void handleSignOut()} className="max-w-28 truncate text-left text-xs font-semibold text-slate-600 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white" title="Sign out">{user.name || user.email || "Account"}</button></div>
        </div>
      </div>
    </header>
  </>
}
