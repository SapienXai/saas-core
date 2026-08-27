"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import {
  Activity,
  ArrowLeft,
  Building2,
  Check,
  ChevronRight,
  CreditCard,
  DatabaseZap,
  LayoutDashboard,
  Milestone,
  Moon,
  MoreHorizontal,
  Settings2,
  Shield,
  Store,
  Sun,
  Users,
  UsersRound,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { PlatformSearch } from "@/components/platform/platform-search"

const primaryNavigation = [
  { href: "/platform", label: "Home", desktopLabel: "Overview", icon: LayoutDashboard },
  { href: "/platform/workspaces", label: "Workspaces", desktopLabel: "Workspaces", icon: Building2 },
  { href: "/platform/restaurants", label: "Restaurants", desktopLabel: "Restaurants", icon: Store },
  { href: "/platform/dataengine", label: "DataEngine", desktopLabel: "DataEngine", icon: DatabaseZap },
  { href: "/platform/users", label: "Users", desktopLabel: "Users", icon: Users },
]

const moreNavigation = [
  { href: "/platform/billing", label: "Billing & plans", icon: CreditCard },
  { href: "/platform/domains", label: "Domains", icon: Store },
  { href: "/platform/health", label: "Operations health", icon: Activity },
  { href: "/platform/lifecycle", label: "Customer lifecycle", icon: Milestone },
  { href: "/platform/team", label: "Platform team", icon: Shield },
  { href: "/platform/settings", label: "Settings", icon: Settings2 },
]

const titleByPath: Array<[string, string]> = [
  ["/platform/workspaces", "Workspaces"],
  ["/platform/restaurants", "Restaurants"],
  ["/platform/dataengine", "DataEngine"],
  ["/platform/users", "Users"],
  ["/platform/billing", "Billing & plans"],
  ["/platform/domains", "Domains"],
  ["/platform/health", "Operations health"],
  ["/platform/lifecycle", "Customer lifecycle"],
  ["/platform/audit", "Activity"],
  ["/platform/team", "Platform team"],
  ["/platform/settings", "Settings"],
  ["/platform/alerts", "Alerts"],
]

const platformThemeStyles = `
  body[data-platform-theme="light"] .platform-root [class~="text-white"] { color: #0f172a !important; }
  body[data-platform-theme="light"] .platform-root [class~="text-slate-100"] { color: #0f172a !important; }
  body[data-platform-theme="light"] .platform-root [class~="text-slate-200"] { color: #1e293b !important; }
  body[data-platform-theme="light"] .platform-root [class~="text-slate-300"] { color: #334155 !important; }
  body[data-platform-theme="light"] .platform-root [class~="text-slate-400"] { color: #475569 !important; }
  body[data-platform-theme="light"] .platform-root [class~="text-slate-500"],
  body[data-platform-theme="light"] .platform-root [class~="text-slate-600"] { color: #64748b !important; }
  body[data-platform-theme="light"] .platform-root [class~="text-violet-200"],
  body[data-platform-theme="light"] .platform-root [class~="text-violet-300"],
  body[data-platform-theme="light"] .platform-root [class~="text-violet-400"] { color: #6d28d9 !important; }
  body[data-platform-theme="light"] .platform-root [class~="text-emerald-200"],
  body[data-platform-theme="light"] .platform-root [class~="text-emerald-300"] { color: #047857 !important; }
  body[data-platform-theme="light"] .platform-root [class~="text-amber-200"],
  body[data-platform-theme="light"] .platform-root [class~="text-amber-300"] { color: #b45309 !important; }
  body[data-platform-theme="light"] .platform-root [class~="text-rose-300"] { color: #be123c !important; }
  body[data-platform-theme="light"] .platform-root [class~="text-sky-200"] { color: #0369a1 !important; }
  body[data-platform-theme="light"] .platform-root [class~="bg-slate-950"],
  body[data-platform-theme="light"] .platform-root [class*="bg-slate-950/"],
  body[data-platform-theme="light"] .platform-root [class*="bg-white/"] { background-color: #ffffff !important; }
  body[data-platform-theme="light"] .platform-root [class*="border-white"] { border-color: #e2e8f0 !important; }
  body[data-platform-theme="light"] .platform-root [class*="hover:bg-white/"]:hover { background-color: #f1f5f9 !important; }
  body[data-platform-theme="light"] .platform-root [class*="hover:text-white"]:hover { color: #0f172a !important; }
  body[data-platform-theme="light"] .platform-root [class*="bg-violet-"] [class~="text-white"],
  body[data-platform-theme="light"] .platform-root [class*="bg-violet-"][class~="text-white"] { color: #ffffff !important; }
  body[data-platform-theme="light"] .platform-root input,
  body[data-platform-theme="light"] .platform-root textarea,
  body[data-platform-theme="light"] .platform-root select { border-color: #cbd5e1; background-color: #ffffff; color: #0f172a; }
  body[data-platform-theme="light"] .platform-root input::placeholder,
  body[data-platform-theme="light"] .platform-root textarea::placeholder { color: #64748b; }

  body[data-platform-theme="dark"] .platform-root [class~="bg-white"] { background-color: #1e293b !important; }
  body[data-platform-theme="dark"] .platform-root [class~="text-slate-950"] { color: #f8fafc !important; }
  body[data-platform-theme="dark"] .platform-root [class*="hover:bg-white/"]:hover { background-color: #1e293b !important; }
  body[data-platform-theme="dark"] .platform-root input,
  body[data-platform-theme="dark"] .platform-root textarea,
  body[data-platform-theme="dark"] .platform-root select { border-color: rgba(255,255,255,.14); background-color: #0f172a; color: #f8fafc; }
  body[data-platform-theme="dark"] .platform-root input::placeholder,
  body[data-platform-theme="dark"] .platform-root textarea::placeholder { color: #64748b; }

  body[data-platform-theme="light"] [role="dialog"],
  body[data-platform-theme="light"] [data-radix-popper-content-wrapper] > * { background-color: #ffffff !important; border-color: #e2e8f0 !important; color: #0f172a !important; }
  body[data-platform-theme="light"] [role="dialog"] [class~="bg-slate-950"],
  body[data-platform-theme="light"] [role="dialog"] [class*="bg-white/"],
  body[data-platform-theme="light"] [data-radix-popper-content-wrapper] [class~="bg-slate-950"],
  body[data-platform-theme="light"] [data-radix-popper-content-wrapper] [class*="bg-white/"] { background-color: #ffffff !important; }
  body[data-platform-theme="light"] [role="dialog"] [class~="text-white"],
  body[data-platform-theme="light"] [data-radix-popper-content-wrapper] [class~="text-white"] { color: #0f172a !important; }
  body[data-platform-theme="light"] [role="dialog"] [class~="text-slate-200"],
  body[data-platform-theme="light"] [role="dialog"] [class~="text-slate-300"],
  body[data-platform-theme="light"] [data-radix-popper-content-wrapper] [class~="text-slate-200"],
  body[data-platform-theme="light"] [data-radix-popper-content-wrapper] [class~="text-slate-300"] { color: #334155 !important; }
  body[data-platform-theme="light"] [role="dialog"] [class~="text-slate-400"],
  body[data-platform-theme="light"] [role="dialog"] [class~="text-slate-500"],
  body[data-platform-theme="light"] [role="dialog"] [class~="text-slate-600"],
  body[data-platform-theme="light"] [data-radix-popper-content-wrapper] [class~="text-slate-400"],
  body[data-platform-theme="light"] [data-radix-popper-content-wrapper] [class~="text-slate-500"],
  body[data-platform-theme="light"] [data-radix-popper-content-wrapper] [class~="text-slate-600"] { color: #64748b !important; }
  body[data-platform-theme="light"] [role="dialog"] input,
  body[data-platform-theme="light"] [role="dialog"] textarea,
  body[data-platform-theme="light"] [role="dialog"] select,
  body[data-platform-theme="light"] [data-radix-popper-content-wrapper] input,
  body[data-platform-theme="light"] [data-radix-popper-content-wrapper] textarea,
  body[data-platform-theme="light"] [data-radix-popper-content-wrapper] select { border-color: #cbd5e1 !important; background-color: #ffffff !important; color: #0f172a !important; }
  body[data-platform-theme="light"] [role="dialog"] [class*="bg-violet-"][class~="text-white"] { color: #ffffff !important; }

  body[data-platform-theme="dark"] [role="dialog"],
  body[data-platform-theme="dark"] [data-radix-popper-content-wrapper] > * { background-color: #0f172a !important; border-color: rgba(255,255,255,.12) !important; color: #f8fafc !important; }
  body[data-platform-theme="dark"] [role="dialog"] [class~="bg-white"],
  body[data-platform-theme="dark"] [data-radix-popper-content-wrapper] [class~="bg-white"] { background-color: #1e293b !important; }
  body[data-platform-theme="dark"] [role="dialog"] [class~="text-slate-950"],
  body[data-platform-theme="dark"] [data-radix-popper-content-wrapper] [class~="text-slate-950"] { color: #f8fafc !important; }
  body[data-platform-theme="dark"] [role="dialog"] input,
  body[data-platform-theme="dark"] [role="dialog"] textarea,
  body[data-platform-theme="dark"] [role="dialog"] select,
  body[data-platform-theme="dark"] [data-radix-popper-content-wrapper] input,
  body[data-platform-theme="dark"] [data-radix-popper-content-wrapper] textarea,
  body[data-platform-theme="dark"] [data-radix-popper-content-wrapper] select { border-color: rgba(255,255,255,.14) !important; background-color: #0f172a !important; color: #f8fafc !important; }
`

function isActive(pathname: string, href: string) {
  return pathname === href || (href !== "/platform" && pathname.startsWith(`${href}/`))
}

function PlatformNavigation({ pathname, isDark, mobile, onNavigate, onToggleTheme }: { pathname: string; isDark: boolean; mobile?: boolean; onNavigate?: () => void; onToggleTheme: () => void }) {
  const muted = isDark ? "text-slate-400" : "text-slate-500"
  const hover = isDark ? "hover:bg-white/[0.06] hover:text-white" : "hover:bg-slate-100 hover:text-slate-950"
  return (
    <div className={cn("flex h-full min-h-0 flex-col", mobile && "px-4 py-5")}>
      <div className="px-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-violet-500">Reservevia</p>
        <div className="mt-1 flex items-center justify-between gap-2"><h1 className={cn("text-lg font-semibold tracking-tight", isDark ? "text-white" : "text-slate-950")}>Mission Control</h1><span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-300">Live</span></div>
        <p className={cn("mt-1 text-xs", muted)}>Platform operations</p>
      </div>
      <nav className="mt-7 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1" aria-label="Platform navigation">
        <p className={cn("px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.18em]", muted)}>Operate</p>
        {primaryNavigation.map((item) => {
          const Icon = item.icon
          const active = isActive(pathname, item.href)
          return <Link key={item.href} href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={cn("flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition", active ? "bg-violet-500 text-white shadow-lg shadow-violet-500/20" : cn(muted, hover))}><Icon className="h-4 w-4" />{item.desktopLabel}</Link>
        })}
        <p className={cn("px-3 pb-2 pt-6 text-[10px] font-bold uppercase tracking-[0.18em]", muted)}>Control</p>
        {moreNavigation.map((item) => {
          const Icon = item.icon
          const active = isActive(pathname, item.href)
          return <Link key={item.href} href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={cn("flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition", active ? "bg-violet-500 text-white shadow-lg shadow-violet-500/20" : cn(muted, hover))}><Icon className="h-4 w-4" />{item.label}</Link>
        })}
        <Link href="/platform/audit" onClick={onNavigate} aria-current={isActive(pathname, "/platform/audit") ? "page" : undefined} className={cn("flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition", isActive(pathname, "/platform/audit") ? "bg-violet-500 text-white shadow-lg shadow-violet-500/20" : cn(muted, hover))}><Activity className="h-4 w-4" />Activity log</Link>
      </nav>
      <div className={cn("space-y-1.5 border-t pt-4", isDark ? "border-white/10" : "border-slate-200")}>
        <button type="button" onClick={onToggleTheme} className={cn("flex min-h-11 w-full items-center justify-between rounded-xl px-3 text-sm font-semibold transition", muted, hover)} aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}><span className="flex items-center gap-2">{isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}{isDark ? "Light theme" : "Dark theme"}</span><Check className="h-3.5 w-3.5 opacity-60" /></button>
        <Link href="/manage" onClick={onNavigate} className={cn("flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold transition", muted, hover)}><ArrowLeft className="h-4 w-4" />Back to workspace</Link>
      </div>
    </div>
  )
}

function BottomNavigation({ pathname, onMore }: { pathname: string; onMore: () => void }) {
  const items = [
    { href: "/platform", label: "Home", icon: LayoutDashboard },
    { href: "/platform/workspaces", label: "Customers", icon: UsersRound },
    { href: "/platform/alerts", label: "Alerts", icon: Shield },
    { href: "/platform/audit", label: "Activity", icon: Activity },
  ]
  return <nav aria-label="Quick platform navigation" className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-slate-950/95 px-2 pb-[env(safe-area-inset-bottom)] pt-1.5 shadow-[0_-12px_40px_rgba(2,6,23,0.22)] backdrop-blur lg:hidden"><div className="mx-auto grid max-w-lg grid-cols-5 gap-1">{items.map((item) => { const Icon = item.icon; const active = isActive(pathname, item.href); return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={cn("flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] font-semibold transition", active ? "bg-violet-500/15 text-violet-200" : "text-slate-500 hover:bg-white/[0.05] hover:text-slate-200")}><Icon className="h-4 w-4" />{item.label}</Link> })}<button type="button" onClick={onMore} className="flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] font-semibold text-slate-500 transition hover:bg-white/[0.05] hover:text-slate-200"><MoreHorizontal className="h-4 w-4" />More</button></div></nav>
}

export function PlatformShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [isDark, setIsDark] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const title = useMemo(() => titleByPath.find(([prefix]) => isActive(pathname, prefix))?.[1] || "Overview", [pathname])
  useEffect(() => setIsDark(window.localStorage.getItem("reservevia:platform:theme") === "dark"), [])
  useEffect(() => window.localStorage.setItem("reservevia:platform:theme", isDark ? "dark" : "light"), [isDark])
  useEffect(() => {
    const backgroundColor = isDark ? "#020617" : "#f8fafc"
    const root = document.documentElement
    const body = document.body
    const platformTheme = isDark ? "dark" : "light"
    const themeColorMeta = document.querySelector('meta[name="theme-color"]')
    const previousRootBackground = root.style.backgroundColor
    const previousBodyBackground = body.style.backgroundColor
    const previousThemeColor = themeColorMeta?.getAttribute("content")

    body.dataset.platformTheme = platformTheme
    root.style.backgroundColor = backgroundColor
    body.style.backgroundColor = backgroundColor
    themeColorMeta?.setAttribute("content", backgroundColor)

    return () => {
      if (body.dataset.platformTheme === platformTheme) delete body.dataset.platformTheme
      root.style.backgroundColor = previousRootBackground
      body.style.backgroundColor = previousBodyBackground
      if (themeColorMeta && previousThemeColor) themeColorMeta.setAttribute("content", previousThemeColor)
    }
  }, [isDark])
  useEffect(() => {
    const style = document.createElement("style")
    style.dataset.platformTheme = "true"
    style.textContent = platformThemeStyles
    document.head.appendChild(style)
    return () => style.remove()
  }, [])
  const shell = isDark ? "bg-slate-950 text-slate-100" : "bg-slate-50 text-slate-950"
  const border = isDark ? "border-white/10" : "border-slate-200"
  const header = isDark ? "bg-slate-950/90" : "bg-white/90"
  const muted = isDark ? "text-slate-400" : "text-slate-500"
  return (
    <div data-platform-theme={isDark ? "dark" : "light"} className={cn("platform-root min-h-screen transition-colors", shell)}>
      <aside className={cn("fixed inset-y-0 left-0 hidden w-64 border-r px-4 py-6 lg:block", border, isDark ? "bg-slate-950/95" : "bg-white/95")}><PlatformNavigation pathname={pathname} isDark={isDark} onToggleTheme={() => setIsDark((current) => !current)} /></aside>
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className={cn("max-h-[min(88dvh,42rem)] rounded-t-3xl p-0 pb-[env(safe-area-inset-bottom)]", isDark ? "border-white/10 bg-slate-950" : "border-slate-200 bg-white")}><div className="mx-auto w-full max-w-lg"><div className="flex items-center justify-between border-b border-white/10 px-5 py-4"><div><SheetTitle className={isDark ? "text-white" : "text-slate-950"}>More controls</SheetTitle><SheetDescription className={cn("mt-1", muted)}>Settings and platform tools</SheetDescription></div><button type="button" onClick={() => setMoreOpen(false)} aria-label="Close more controls" className={cn("flex h-10 w-10 items-center justify-center rounded-xl", muted, isDark ? "hover:bg-white/[0.07]" : "hover:bg-slate-100")}><X className="h-5 w-5" /></button></div><div className="grid gap-1 p-4">{moreNavigation.map((item) => { const Icon = item.icon; const active = isActive(pathname, item.href); return <Link key={item.href} href={item.href} onClick={() => setMoreOpen(false)} className={cn("flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-semibold", active ? "bg-violet-500 text-white" : cn(muted, isDark ? "hover:bg-white/[0.06] hover:text-white" : "hover:bg-slate-100 hover:text-slate-950"))}><Icon className="h-4 w-4" />{item.label}<ChevronRight className="ml-auto h-4 w-4 opacity-50" /></Link>})}<Link href="/platform/audit" onClick={() => setMoreOpen(false)} className={cn("flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-semibold", muted, isDark ? "hover:bg-white/[0.06] hover:text-white" : "hover:bg-slate-100 hover:text-slate-950")}><Activity className="h-4 w-4" />Activity log<ChevronRight className="ml-auto h-4 w-4 opacity-50" /></Link><button type="button" onClick={() => setIsDark((current) => !current)} className={cn("flex min-h-12 items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold", muted, isDark ? "hover:bg-white/[0.06] hover:text-white" : "hover:bg-slate-100 hover:text-slate-950")}>{isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}{isDark ? "Light theme" : "Dark theme"}<Check className="ml-auto h-4 w-4 opacity-50" /></button><Link href="/manage" onClick={() => setMoreOpen(false)} className={cn("flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-semibold", muted, isDark ? "hover:bg-white/[0.06] hover:text-white" : "hover:bg-slate-100 hover:text-slate-950")}><ArrowLeft className="h-4 w-4" />Back to workspace</Link></div></div></SheetContent>
      </Sheet>
      <div className="lg:pl-64">
        <header className={cn("sticky top-0 z-20 border-b px-3 py-2.5 backdrop-blur sm:px-6 lg:px-8", border, header)}><div className="mx-auto flex w-full max-w-[80rem] items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><div className="lg:hidden"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-500">Reservevia</p><p className={cn("mt-0.5 truncate text-sm font-semibold", isDark ? "text-white" : "text-slate-950")}>{title}</p></div><p className={cn("hidden text-sm font-semibold lg:block", isDark ? "text-white" : "text-slate-950")}>{title}</p></div><div className="flex min-w-0 flex-1 items-center justify-end"><div className="hidden min-w-0 flex-1 justify-end lg:flex"><PlatformSearch /></div><div className="lg:hidden"><PlatformSearch compact /></div></div></div></header>
        <main className="mx-auto w-full max-w-[80rem] px-3 pb-[calc(5.75rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:pb-10 sm:pt-6 lg:px-8 lg:pt-8">{children}</main>
      </div>
      <BottomNavigation pathname={pathname} onMore={() => setMoreOpen(true)} />
    </div>
  )
}
