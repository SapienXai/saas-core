"use client"

import { useEffect, useMemo, useState } from "react"
import { Activity, Bell, ChartNoAxesCombined, ChevronLeft, CircleDot, CreditCard, FolderKanban, Globe2, HelpCircle, LayoutDashboard, LogOut, Menu, Plus, Settings, ShieldCheck, Users } from "lucide-react"
import { cn } from "./utils.js"
import { ThemeToggle } from "./theme.js"
import { WorkspaceSwitcher } from "./views.js"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./primitives/sheet.js"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./primitives/tooltip.js"
import type { AppShellProps, NavIconName, NavigationGroup, NavItem } from "./shell.js"

const iconMap: Record<NavIconName, typeof LayoutDashboard> = { "layout-dashboard": LayoutDashboard, users: Users, "credit-card": CreditCard, "shield-check": ShieldCheck, settings: Settings, activity: Activity, globe: Globe2, bell: Bell, folder: FolderKanban, chart: ChartNoAxesCombined, help: HelpCircle, plus: Plus, circle: CircleDot }
function NavGlyph({ name }: { name: string | undefined }) { const Icon = (name && name in iconMap ? iconMap[name as NavIconName] : CircleDot) ?? CircleDot; return <Icon size={18} strokeWidth={1.8} aria-hidden="true" /> }
function Brand({ productName, brand, compact = false }: { productName: string; brand?: AppShellProps["brand"]; compact?: boolean }) { const name = brand?.name ?? productName; return <a className={cn("sc-brand", compact && "sc-brand-compact")} href="/app" aria-label={`${name} home`}>{brand?.logo ? <img src={brand.logo} alt="" className="sc-brand-logo" /> : <span className="sc-brand-mark" aria-hidden="true">{brand?.icon ?? name.slice(0, 1).toUpperCase()}</span>}<span className="sc-brand-copy"><strong>{name}</strong><small>Workspace platform</small></span></a> }

function Navigation({ items, groups, collapsed = false, onNavigate }: { items: NavItem[]; groups?: NavigationGroup[]; collapsed?: boolean; onNavigate?: () => void }) {
  const renderItem = (item: NavItem) => {
    const link = <a className={cn("sc-nav-item", item.active && "sc-nav-item-active", item.disabled && "sc-nav-item-disabled")} href={item.disabled ? undefined : item.href} key={item.href} aria-current={item.active ? "page" : undefined} aria-disabled={item.disabled || undefined} onClick={item.disabled ? (event) => event.preventDefault() : onNavigate}><span className="sc-nav-icon"><NavGlyph name={item.icon} /></span><span className="sc-nav-label">{item.label}</span>{item.badge && <span className="sc-nav-badge">{item.badge}</span>}</a>
    if (!collapsed) return link
    return <Tooltip key={item.href}><TooltipTrigger asChild>{link}</TooltipTrigger><TooltipContent side="right">{item.label}</TooltipContent></Tooltip>
  }
  return <nav className="sc-nav" aria-label="Application navigation">{groups?.length ? groups.map((group) => <div className="sc-nav-group" key={group.label}><span className="sc-nav-group-label">{!collapsed && group.label}</span>{group.items.map(renderItem)}</div>) : items.map(renderItem)}</nav>
}

function Account({ userEmail }: { userEmail: string | null | undefined }) { const initial = (userEmail ?? "U").slice(0, 1).toUpperCase(); return <div className="sc-account"><span className="sc-avatar" aria-hidden="true">{initial}</span><span className="sc-account-copy"><strong>{userEmail ?? "Signed in"}</strong><small>Account</small></span></div> }

export function AppShellClient({ productName, userEmail, nav = [], navigationGroups, workspaces = [], currentWorkspaceId, brand, children }: AppShellProps) {
  const baseItems = useMemo(() => nav.length ? nav : [{ label: "Overview", href: "/app", active: true, icon: "layout-dashboard" }, { label: "Team", href: "/app/team", icon: "users" }, { label: "Plan & Usage", href: "/app/plan", icon: "credit-card" }, { label: "Setup", href: "/app/setup", icon: "shield-check" }, { label: "Settings", href: "/app/settings", icon: "settings" }], [nav])
  const [pathname, setPathname] = useState("")
  useEffect(() => {
    const syncPathname = () => setPathname(window.location.pathname)
    syncPathname()
    window.addEventListener("popstate", syncPathname)
    return () => window.removeEventListener("popstate", syncPathname)
  }, [])
  const isActive = (href: string) => href.startsWith("/") && (href === "/app" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`))
  const items = useMemo(() => baseItems.map((item) => pathname ? { ...item, active: isActive(item.href) } : item), [baseItems, pathname])
  const groups = useMemo(() => navigationGroups?.map((group) => ({ ...group, items: group.items.map((item) => pathname ? { ...item, active: isActive(item.href) } : item) })), [navigationGroups, pathname])
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  useEffect(() => { try { setCollapsed(window.localStorage.getItem("saas-core-sidebar") === "collapsed") } catch { /* optional preference */ } }, [])
  const toggleCollapsed = () => setCollapsed((value) => { const next = !value; try { window.localStorage.setItem("saas-core-sidebar", next ? "collapsed" : "expanded") } catch { /* optional preference */ } return next })
  useEffect(() => { const onKeyDown = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") { event.preventDefault(); toggleCollapsed() } if (event.key === "Escape") setMobileOpen(false) }; window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown) }, [])
  const navProps = { items, ...(groups ? { groups } : {}) }
  return <TooltipProvider delayDuration={250}><div className="sc-shell" data-sidebar-state={collapsed ? "collapsed" : "expanded"}><aside className="sc-sidebar" aria-label="Application navigation"><div className="sc-sidebar-top"><Brand productName={productName} brand={brand} /><Tooltip><TooltipTrigger asChild><button type="button" className="sc-sidebar-toggle" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-pressed={collapsed} onClick={toggleCollapsed}><ChevronLeft className={cn("sc-sidebar-toggle-icon", collapsed && "sc-sidebar-toggle-icon-collapsed")} size={18} aria-hidden="true" /></button></TooltipTrigger><TooltipContent side="right">{collapsed ? "Expand sidebar" : "Collapse sidebar"}</TooltipContent></Tooltip></div>{!collapsed && workspaces.length > 0 && <WorkspaceSwitcher workspaces={workspaces} {...(currentWorkspaceId ? { currentId: currentWorkspaceId } : {})} /> }<Navigation {...navProps} collapsed={collapsed} /><div className="sc-sidebar-footer"><div className="sc-sidebar-actions"><ThemeToggle />{!collapsed && <span className="sc-sidebar-hint">⌘ B</span>}</div><Account userEmail={userEmail} />{!collapsed && <a className="sc-signout" href="/api/auth/signout">Sign out</a>}</div></aside><div className="sc-main"><header className="sc-mobile-header"><button type="button" className="sc-icon-button" aria-label={`Open ${productName} navigation`} aria-expanded={mobileOpen} aria-controls="sc-mobile-navigation" onClick={() => setMobileOpen(true)}><Menu size={18} aria-hidden="true" /></button><Brand productName={productName} brand={brand} compact /><div className="sc-mobile-actions"><ThemeToggle /><a className="sc-icon-button" href="/api/auth/signout" aria-label="Sign out"><LogOut size={17} aria-hidden="true" /></a></div></header><Sheet open={mobileOpen} onOpenChange={setMobileOpen}><SheetContent id="sc-mobile-navigation" className="sc-mobile-sheet" side="left"><SheetHeader><Brand productName={productName} brand={brand} /><SheetTitle className="sc-sr-only">{productName} navigation</SheetTitle><SheetDescription className="sc-sr-only">Navigate your workspace.</SheetDescription></SheetHeader>{workspaces.length > 0 && <WorkspaceSwitcher workspaces={workspaces} {...(currentWorkspaceId ? { currentId: currentWorkspaceId } : {})} /> }<Navigation {...navProps} onNavigate={() => setMobileOpen(false)} /></SheetContent></Sheet><main className="sc-main-content">{children}</main></div></div></TooltipProvider>
}

/** @deprecated AppShell now owns mobile navigation. Kept for early 1.2 consumers. */
export function MobileNavigation({ productName, items, groups }: { productName: string; items: NavItem[]; groups?: NavigationGroup[] }) { const [open, setOpen] = useState(false); return <><button type="button" className="sc-icon-button" aria-label={`Open ${productName} navigation`} onClick={() => setOpen(true)}><Menu size={18} aria-hidden="true" /></button><Sheet open={open} onOpenChange={setOpen}><SheetContent side="left"><SheetHeader><SheetTitle>{productName}</SheetTitle></SheetHeader><Navigation items={items} {...(groups ? { groups } : {})} onNavigate={() => setOpen(false)} /></SheetContent></Sheet></> }
