"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Activity, AlertCircle, Archive, ArrowUpRight, BarChart3, Briefcase, CalendarDays, Check, ChevronDown, ChevronRight, Crown, FileText, Folder, Globe2, Layers3, LayoutDashboard, List, LogOut, Moon, Music2, Package, PanelLeftClose, PanelLeftOpen, Plus, Settings2, Smartphone, Sun, Users, WalletCards, X, type LucideIcon } from "lucide-react"
import { useLanguage } from "@/context/language-context"
import { useManageContext } from "@/context/manage-context"
import { cn } from "@/lib/utils"
import { ManagePushNotificationSwitch } from "@/components/manage/manage-push-notification-switch"
import { WorkspaceSwitcher } from "@/components/manage/workspace-switcher"
import { WorkspaceUpgradeModal } from "@/components/manage/workspace-upgrade-modal"
import { localeConfig, type SupportedLanguage } from "@/i18n"
import { getPlanNavigationHref } from "@/lib/plan-navigation"
import { PRODUCT_CONFIG } from "@/lib/product-config"
import { getActiveProductNavigationKey, isProductHomeActive, isProductNavigationVisible, resolveProductShell } from "@/lib/product-shell"
import { getActivePlatformNavigationKey, isPlatformNavigationVisible, resolvePlatformNavigation } from "@/lib/platform-navigation"

const SETTINGS_GROUP_STORAGE_KEY = "saas-core:manage:sidebar-settings-open"
const LEGACY_TOOLS_GROUP_STORAGE_KEY = "saas-core:manage:sidebar-tools-open"
type SidebarNavigationItem = {
  key: string
  name: string
  href: string
  icon: LucideIcon
  current: boolean
  disabled: boolean
}

type SidebarUsageItem = {
  label: string
  used: number
  limit: number | null
}

const PRODUCT_NAVIGATION_ICONS: Record<string, LucideIcon> = {
  activity: Activity,
  archive: Archive,
  "bar-chart": BarChart3,
  briefcase: Briefcase,
  calendar: CalendarDays,
  file: FileText,
  folder: Folder,
  layers: Layers3,
  "layout-dashboard": LayoutDashboard,
  list: List,
  music: Music2,
  package: Package,
  settings: Settings2,
  users: Users,
  "wallet-cards": WalletCards,
  globe: Globe2,
  "alert-circle": AlertCircle,
}

function workspaceRoleLabel(role: string | null, getTranslation: ReturnType<typeof useLanguage>["getTranslation"]) {
  switch (role) {
    case "owner": return getTranslation("team.roleOwner")
    case "admin": return getTranslation("team.roleAdmin")
    case "manager": return getTranslation("team.roleManager")
    case "readonly": return getTranslation("manage.users.form.readonly")
    case "staff": return getTranslation("team.roleStaff")
    default: return getTranslation("manage.common.noWorkspaceMembership")
  }
}

function SidebarUsageBars({ items }: { items: SidebarUsageItem[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-2.5 gap-y-1.5">
      {items.map((item) => {
        const percent = item.limit === null ? 0 : Math.min(100, (item.used / Math.max(item.limit, 1)) * 100)
        return (
          <div key={item.label} className="min-w-0">
            <div className="flex items-center justify-between gap-1 text-[10px] leading-none">
              <span className="min-w-0 truncate font-medium text-slate-500 dark:text-slate-400">{item.label}</span>
              <span className="shrink-0 font-bold tabular-nums text-slate-700 dark:text-slate-200">{item.used}/{item.limit === null ? "∞" : item.limit}</span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10" aria-hidden="true">
              <div className="h-full rounded-full bg-violet-500 transition-[width]" style={{ width: item.limit === null ? "8%" : `${percent}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

interface ManageSidebarProps {
  isOpen: boolean
  onClose: () => void
  isCollapsed: boolean
  isDark: boolean
  onThemeChange: (isDark: boolean) => void
  toggleSidebar: () => void
}

export function ManageSidebar({ isOpen, onClose, isCollapsed, isDark, onThemeChange, toggleSidebar }: ManageSidebarProps) {
  const pathname = usePathname()
  const { currentLang, getTranslation, setLanguage } = useLanguage()
  const { role, platformRole, user, currentWorkspace, planCatalog, ownedWorkspaceId, canCreateWorkspace } = useManageContext()
  const isStaff = role === "staff"
  const isDomainAdmin = role === "owner" || role === "admin"
  const currentPlanKey = currentWorkspace?.plan?.key || null
  const currentPlanSortOrder = planCatalog.find((plan) => plan.key === currentPlanKey)?.sortOrder ?? -1
  const nextPlan = planCatalog.filter((plan) => plan.sortOrder > currentPlanSortOrder).sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key))[0]
  const nextPlanKey = nextPlan?.key || null
  const nextPlanLabel = nextPlan?.name || null
  const canShowUpgrade = Boolean(nextPlanKey && nextPlanLabel && currentWorkspace?.role === "owner" && !isStaff)
  const workspaceUsage = currentWorkspace?.usage
  const workspaceLimits = currentWorkspace?.plan?.limits
  const usageItems: SidebarUsageItem[] = workspaceUsage && workspaceLimits
    ? [
        { label: getTranslation("manage.planUsage.workspaces"), used: workspaceUsage.workspaces, limit: workspaceLimits["core.workspaces"] ?? null },
        { label: getTranslation("manage.planUsage.teamMembers"), used: workspaceUsage.users, limit: workspaceLimits["core.members"] ?? null },
      ]
    : []
  const hasWorkspaceUsage = usageItems.length > 0
  const upgradePlanHref = nextPlanKey
    ? getPlanNavigationHref({
        language: currentLang,
        plan: nextPlanKey,
        currentWorkspaceId: currentWorkspace?.id,
        ownedWorkspaceId,
      })
    : "/manage/plan"
  const [settingsGroupOpen, setSettingsGroupOpen] = useState(false)
  const [hasLoadedSettingsGroupPreference, setHasLoadedSettingsGroupPreference] = useState(false)
  const [workspaceUpgradeOpen, setWorkspaceUpgradeOpen] = useState(false)
  const mobileSettingsListRef = useRef<HTMLDivElement>(null)

  const isActive = (path: string) => pathname === path || pathname.startsWith(`${path}/`)
  const hasWorkspaceScope = Boolean(currentWorkspace?.id)
  const productShell = resolveProductShell()
  const visibleProductNavigation = hasWorkspaceScope ? productShell.navigation.filter((item) => isProductNavigationVisible(item, currentWorkspace?.role || role, currentWorkspace?.plan?.features)) : []
  const activeProductNavigationKey = getActiveProductNavigationKey(pathname, visibleProductNavigation)
  const platformNavigation = resolvePlatformNavigation()
  const visiblePlatformNavigation = platformRole ? platformNavigation.filter((item) => isPlatformNavigationVisible(item, platformRole)) : []
  const activePlatformNavigationKey = getActivePlatformNavigationKey(pathname, visiblePlatformNavigation)
  const navigation: SidebarNavigationItem[] = [
    { key: "home", name: productShell.homeLabel || getTranslation("manage.sidebar.dashboard"), href: productShell.homePath, icon: LayoutDashboard, current: isProductHomeActive(pathname, productShell.homePath) && !activeProductNavigationKey, disabled: false },
    ...visibleProductNavigation.map((item) => ({ key: item.key, name: item.label, href: item.href, icon: PRODUCT_NAVIGATION_ICONS[item.icon] || Layers3, current: activeProductNavigationKey === item.key, disabled: false })),
  ]
  const settingsNavigation: SidebarNavigationItem[] = hasWorkspaceScope ? [
    { key: "team", name: getTranslation("manage.sidebar.team"), href: "/app/team", icon: Users, current: isActive("/app/team"), disabled: !isDomainAdmin },
    { key: "plan", name: getTranslation("manage.sidebar.planUsage"), href: "/app/plan", icon: WalletCards, current: isActive("/app/plan"), disabled: isStaff },
    { key: "domains", name: getTranslation("manage.sidebar.domains"), href: "/app/domains", icon: Globe2, current: isActive("/app/domains"), disabled: !isDomainAdmin },
    { key: "pwa", name: getTranslation("manage.sidebar.managementApp"), href: "/app/pwa", icon: Smartphone, current: isActive("/app/pwa"), disabled: false },
  ] : []
  const availableSettingsNavigation = settingsNavigation.filter((item) => !item.disabled)
  const hasActiveSetting = availableSettingsNavigation.some((item) => item.current)

  useEffect(() => {
    const storedPreference = window.localStorage.getItem(SETTINGS_GROUP_STORAGE_KEY) === "1" || window.localStorage.getItem(LEGACY_TOOLS_GROUP_STORAGE_KEY) === "1"
    setSettingsGroupOpen(storedPreference || hasActiveSetting)
    setHasLoadedSettingsGroupPreference(true)
  }, [hasActiveSetting])

  useEffect(() => {
    if (!hasLoadedSettingsGroupPreference) return
    window.localStorage.setItem(SETTINGS_GROUP_STORAGE_KEY, settingsGroupOpen ? "1" : "0")
  }, [hasLoadedSettingsGroupPreference, settingsGroupOpen])

  useEffect(() => {
    if (!isOpen || !settingsGroupOpen || !mobileSettingsListRef.current) return

    const frame = window.requestAnimationFrame(() => {
      const settingsList = mobileSettingsListRef.current
      if (!settingsList) return
      settingsList.focus({ preventScroll: true })
      settingsList.scrollIntoView({ behavior: "smooth", block: "nearest" })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [isOpen, settingsGroupOpen])

  const fallbackUserLabel = isStaff
    ? getTranslation("manage.common.staff")
    : isDomainAdmin
      ? getTranslation("manage.common.administrator")
      : getTranslation("manage.common.workspace")
  const userDisplayName = user.name.trim() || user.email.trim() || fallbackUserLabel
  const userSecondaryLabel = user.email.trim() || fallbackUserLabel
  const currentWorkspaceRole = currentWorkspace?.role || null
  const initials = userDisplayName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "A"

  const content = (mobile = false) => {
    const compact = !mobile && isCollapsed
    const logoAsset = PRODUCT_CONFIG.logoPath
    const settingsListId = mobile ? "manage-sidebar-settings-mobile" : "manage-sidebar-settings"
    const closeAfterUpgradeNavigation = () => {
      if (mobile) {
        onClose()
      } else if (!isCollapsed) {
        toggleSidebar()
      }
    }
    const requestWorkspaceCreation = () => {
      if (mobile) onClose()
      setWorkspaceUpgradeOpen(true)
    }
    return (
    <div className="manage-sidebar-content flex h-full min-h-0 flex-col bg-white text-slate-950 dark:bg-[#0b0c0f] dark:text-white">
      <div className={cn("flex h-14 shrink-0 items-center border-b border-slate-200/80 dark:border-white/10 md:h-16", compact ? "justify-center px-2" : "px-3")}>
        {compact ? (
          <div className="relative">
            <WorkspaceSwitcher compact={compact} isDark={isDark} logoAsset={logoAsset} onClose={mobile ? onClose : undefined} canCreateWorkspace={canCreateWorkspace} onCreateWorkspace={requestWorkspaceCreation} />
            <TooltipProvider delayDuration={180}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" onClick={toggleSidebar} className="absolute -bottom-1 -right-1 z-10 flex h-5 w-5 items-center justify-center rounded-md border border-white bg-violet-600 text-white shadow-sm dark:border-[#0b0c0f]" aria-label={getTranslation("manage.common.openSidebar")}>
                    <PanelLeftOpen className="h-3 w-3" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={10} className="manage-sidebar-tooltip">{getTranslation("manage.common.openSidebar")}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        ) : (
          <WorkspaceSwitcher
            compact={compact}
            isDark={isDark}
            logoAsset={logoAsset}
            onClose={mobile ? onClose : undefined}
            headerAction={mobile ? (
              <div className="ml-1.5 flex h-9 items-center border-l border-slate-200/80 pl-1.5 dark:border-white/10">
                <button type="button" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-200/70 dark:text-slate-400 dark:hover:bg-white/10" aria-label={getTranslation("manage.common.closeSidebar")}>
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <div className="ml-1.5 flex h-9 items-center border-l border-slate-200/80 pl-1.5 dark:border-white/10">
                <button type="button" onClick={toggleSidebar} className="manage-sidebar-toggle flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-200/70 dark:text-slate-400 dark:hover:bg-white/10" title={getTranslation("manage.common.collapseSidebar")} aria-label={getTranslation("manage.common.collapseSidebar")} aria-expanded="true" aria-controls="manage-sidebar-desktop">
                  <PanelLeftClose className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
            )}
            canCreateWorkspace={canCreateWorkspace}
            onCreateWorkspace={requestWorkspaceCreation}
          />
        )}
      </div>

      <ScrollArea className={cn("min-h-0 flex-1", mobile ? "py-3" : "py-5", compact ? "px-1.5" : "px-3")}>
        {!compact && hasWorkspaceScope && <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">{getTranslation("manage.common.workspace")}</p>}
        <TooltipProvider delayDuration={180}>
          {hasWorkspaceScope && <nav className="manage-sidebar-nav space-y-1.5">
            {navigation.map((item) => {
              const Icon = item.icon
              const itemClass = cn(
                "group flex min-w-0 items-center text-sm font-semibold transition-all duration-200",
                compact ? "mx-auto h-10 w-10 min-h-0 justify-center rounded-xl px-0" : "min-h-11 w-full gap-3 rounded-xl px-3",
                item.current
                  ? "bg-violet-600 text-white shadow-md shadow-violet-500/20"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-white/[0.07] dark:hover:text-white",
                item.disabled && "cursor-not-allowed opacity-40"
              )

              const itemContent = <><span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", item.current ? "bg-white/15" : "bg-slate-100 text-slate-500 group-hover:bg-white dark:bg-white/5 dark:text-slate-400")}><Icon className="h-4 w-4" /></span>{!compact && <span className="min-w-0 flex-1 truncate">{item.name}</span>}{!compact && item.current && <ChevronRight className="h-4 w-4 shrink-0 opacity-70" />}</>
              const itemElement = item.disabled
                ? <div key={item.key} className={itemClass} aria-disabled title={getTranslation("manage.common.administratorRequired")}>{itemContent}</div>
                : <Link key={item.key} href={`${item.href}?lang=${currentLang}`} className={itemClass} aria-current={item.current ? "page" : undefined} onClick={mobile ? onClose : undefined}>{itemContent}</Link>

              if (!compact) return itemElement

              return (
                <Tooltip key={item.key}>
                  <TooltipTrigger asChild>{itemElement}</TooltipTrigger>
                  <TooltipContent side="right" sideOffset={10} className="manage-sidebar-tooltip">{item.name}</TooltipContent>
                </Tooltip>
              )
            })}
          </nav>}
          {visiblePlatformNavigation.length > 0 && <div className={cn("manage-sidebar-platform-group", hasWorkspaceScope ? "mt-5 border-t border-slate-200/80 pt-4 dark:border-white/10" : "mt-1")}><p className={cn("px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-violet-600 dark:text-violet-300", compact && "sr-only")}>Platform</p><nav className="manage-sidebar-platform-nav space-y-1.5">{visiblePlatformNavigation.map((item) => { const Icon = PRODUCT_NAVIGATION_ICONS[item.icon] || Layers3; const current = activePlatformNavigationKey === item.key; const itemClass = cn("group flex min-w-0 items-center text-sm font-semibold transition-all duration-200", compact ? "mx-auto h-10 w-10 min-h-0 justify-center rounded-xl px-0" : "min-h-11 w-full gap-3 rounded-xl px-3", current ? "bg-violet-600 text-white shadow-md shadow-violet-500/20" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-white/[0.07] dark:hover:text-white"); const itemContent = <><span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", current ? "bg-white/15" : "bg-slate-100 text-slate-500 group-hover:bg-white dark:bg-white/5 dark:text-slate-400")}><Icon className="h-4 w-4" /></span>{!compact && <span className="min-w-0 flex-1 truncate">{item.label}</span>}{!compact && current && <ChevronRight className="h-4 w-4 shrink-0 opacity-70" />}</>; const itemElement = <Link key={item.key} href={`${item.href}?lang=${currentLang}`} className={itemClass} aria-current={current ? "page" : undefined} onClick={mobile ? onClose : undefined}>{itemContent}</Link>; return compact ? <Tooltip key={item.key}><TooltipTrigger asChild>{itemElement}</TooltipTrigger><TooltipContent side="right" sideOffset={10} className="manage-sidebar-tooltip">{item.label}</TooltipContent></Tooltip> : itemElement })}</nav></div>}
          {availableSettingsNavigation.length > 0 && <div className="manage-sidebar-settings-group mt-3">
            {(() => {
              const settingsGroupButton = (
                <button
                  type="button"
                  onClick={() => {
                    if (compact) {
                      setSettingsGroupOpen(true)
                      toggleSidebar()
                      return
                    }
                    setSettingsGroupOpen((current) => !current)
                  }}
                  className={cn(
                    "manage-sidebar-group-toggle group flex min-w-0 items-center text-sm font-semibold transition-all duration-200",
                    compact ? "mx-auto h-10 w-10 justify-center rounded-xl px-0" : "min-h-11 w-full gap-3 rounded-xl px-3",
                    settingsGroupOpen && !compact
                      ? "bg-slate-100 text-slate-950 dark:bg-white/[0.08] dark:text-white"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-white/[0.07] dark:hover:text-white"
                  )}
                  aria-expanded={settingsGroupOpen}
                  aria-controls={settingsListId}
                >
                  <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", settingsGroupOpen && !compact ? "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200" : "bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-400")}>
                    <Layers3 className="h-4 w-4" />
                  </span>
                  {!compact && <span className="min-w-0 flex-1 truncate text-left">{getTranslation("manage.common.settings")}</span>}
                  {!compact && <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", settingsGroupOpen && "rotate-180")} />}
                </button>
              )

              if (!compact) return settingsGroupButton

              return (
                <Tooltip>
                  <TooltipTrigger asChild>{settingsGroupButton}</TooltipTrigger>
                  <TooltipContent side="right" sideOffset={10} className="manage-sidebar-tooltip">{getTranslation("manage.common.openSettings")}</TooltipContent>
                </Tooltip>
              )
            })()}
            {settingsGroupOpen && !compact && (
              <div ref={mobile ? mobileSettingsListRef : undefined} id={settingsListId} tabIndex={mobile ? -1 : undefined} className="manage-sidebar-settings-list mt-1.5 space-y-1.5 pl-2 focus:outline-none">
                {availableSettingsNavigation.map((item) => {
                  const Icon = item.icon
                  const itemClass = cn(
                    "manage-sidebar-setting-item group flex min-h-10 min-w-0 w-full items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-all duration-200",
                    item.current
                      ? "bg-violet-600 text-white shadow-md shadow-violet-500/20"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-white/[0.07] dark:hover:text-white",
                  )
                  const itemContent = <><span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", item.current ? "bg-white/15" : "bg-slate-100 text-slate-500 group-hover:bg-white dark:bg-white/5 dark:text-slate-400")}><Icon className="h-4 w-4" /></span><span className="min-w-0 flex-1 truncate">{item.name}</span>{item.current && <ChevronRight className="h-4 w-4 shrink-0 opacity-70" />}</>
                  return <Link key={item.key} href={`${item.href}?lang=${currentLang}`} className={itemClass} aria-current={item.current ? "page" : undefined} onClick={mobile ? onClose : undefined}>{itemContent}</Link>
                })}
              </div>
            )}
          </div>}
        </TooltipProvider>
      </ScrollArea>

      {canShowUpgrade && nextPlanKey && nextPlanLabel && (
        compact ? (
          <div className="shrink-0 px-1.5 pb-3">
            <TooltipProvider delayDuration={180}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href={upgradePlanHref}
                    onClick={closeAfterUpgradeNavigation}
                    className="group mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-amber-300/70 bg-gradient-to-br from-amber-300 via-yellow-400 to-orange-500 text-white shadow-md shadow-amber-500/25 transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-amber-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 dark:border-amber-200/25 dark:from-amber-300 dark:via-yellow-500 dark:to-orange-500 dark:focus-visible:ring-offset-[#0b0c0f]"
                    aria-label={getTranslation("manage.common.upgradeTo", { plan: nextPlanLabel })}
                  >
                    <Crown className="h-4 w-4 transition-transform duration-300 motion-safe:animate-pulse group-hover:rotate-[-8deg]" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={10} className="manage-sidebar-tooltip">{getTranslation("manage.common.upgradeTo", { plan: nextPlanLabel })}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        ) : (
          <div className="shrink-0 px-3 pb-3">
            <Link
              href={upgradePlanHref}
              onClick={closeAfterUpgradeNavigation}
              className="group block rounded-2xl border border-amber-200/80 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-2.5 transition hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-lg hover:shadow-amber-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 dark:border-amber-300/20 dark:from-amber-400/10 dark:via-white/[0.04] dark:to-orange-500/10 dark:focus-visible:ring-offset-[#0b0c0f]"
            >
              <div className="flex items-center gap-2.5">
                <span className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-amber-300 via-yellow-400 to-orange-500 text-white shadow-sm shadow-amber-500/25">
                  <span className="absolute inset-0 rounded-xl bg-white/20 motion-safe:animate-pulse" aria-hidden="true" />
                  <Crown className="relative h-4 w-4 transition-transform duration-300 motion-safe:animate-pulse group-hover:rotate-[-8deg]" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">{getTranslation("manage.common.nextStep")}</p>
                  <p className="mt-0.5 truncate text-sm font-bold text-slate-950 dark:text-white">{getTranslation("manage.common.upgradeTo", { plan: nextPlanLabel })}</p>
                </div>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-amber-700 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 dark:text-amber-300" aria-hidden="true" />
              </div>
              {hasWorkspaceUsage ? (
                <div className="mt-2 border-t border-amber-200/70 pt-2 dark:border-amber-200/10">
                  <SidebarUsageBars items={usageItems} />
                </div>
              ) : (
                <span className="mt-2 block border-t border-amber-200/70 pt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-amber-700 dark:border-amber-200/10 dark:text-amber-300">{getTranslation("manage.common.viewPlans")}</span>
              )}
            </Link>
          </div>
        )
      )}

      {!compact && !canShowUpgrade && hasWorkspaceUsage && (
        <div className="manage-sidebar-usage shrink-0 border-t border-slate-200/80 px-3 py-2.5 dark:border-white/10">
          <SidebarUsageBars items={usageItems} />
        </div>
      )}

      <div className={cn("shrink-0 border-t border-slate-200/80 dark:border-white/10", mobile ? "p-2" : "p-3")}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex w-full items-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500",
                compact
                  ? "justify-center rounded-xl p-0 hover:bg-transparent dark:hover:bg-transparent"
                  : mobile
                    ? "gap-2 rounded-xl bg-slate-100/80 px-2 py-1.5 text-left hover:bg-slate-200/80 dark:bg-white/[0.06] dark:hover:bg-white/[0.1]"
                    : "gap-3 rounded-2xl bg-slate-100/80 p-2.5 text-left hover:bg-slate-200/80 dark:bg-white/[0.06] dark:hover:bg-white/[0.1]"
              )}
            >
              <span className={cn("flex shrink-0 items-center justify-center bg-gradient-to-br from-slate-900 to-slate-700 text-xs font-bold text-white dark:from-violet-500 dark:to-indigo-500", mobile ? "h-8 w-8 rounded-lg" : "h-9 w-9 rounded-xl")}>{initials}</span>
              {!compact && <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-slate-800 dark:text-white">{userDisplayName}</p>
                <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{userSecondaryLabel}</p>
              </div>}
              {!compact && <ChevronRight className="h-4 w-4 text-slate-400" />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side={compact ? "right" : "top"} align={compact ? "end" : "start"} sideOffset={compact ? 12 : 10} className={cn("w-[17rem] rounded-2xl border p-2.5 shadow-2xl shadow-slate-950/20", isDark ? "border-white/10 bg-[#1b1c27] text-white" : "border-slate-200 bg-white text-slate-950")}>
          <div className={isDark ? "dark" : undefined}>
            <div className="flex items-center gap-3 border-b border-slate-100 px-2 pb-3 dark:border-white/10">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 text-xs font-bold text-white">{initials}</span>
              <div className="min-w-0"><p className="truncate text-xs font-bold">{userDisplayName}</p><p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{userSecondaryLabel}</p></div>
            </div>
            <div className="space-y-1.5 border-b border-slate-100 px-2 py-3 dark:border-white/10">
              <div className="flex items-center justify-between gap-3 text-[11px]"><span className="text-slate-400">{getTranslation("manage.common.workspaceRole")}</span><span className="truncate font-semibold text-slate-700 dark:text-slate-200">{workspaceRoleLabel(currentWorkspaceRole, getTranslation)}</span></div>
              {platformRole && <div className="flex items-center justify-between gap-3 text-[11px]"><span className="text-slate-400">{getTranslation("manage.common.platformRole")}</span><span className="truncate font-semibold capitalize text-violet-700 dark:text-violet-300">{platformRole.replaceAll("_", " ")}</span></div>}
            </div>
            <div className="px-1 py-3">
              <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{getTranslation("language.label")}</p>
              <div className="grid grid-cols-2 gap-1.5">
                {(Object.entries(localeConfig) as Array<[SupportedLanguage, (typeof localeConfig)[SupportedLanguage]]>).map(([value, config]) => (
                  <button key={value} type="button" onClick={() => setLanguage(value)} className={cn("flex items-center gap-2 rounded-xl border px-2.5 py-2 text-xs font-semibold transition-colors", currentLang === value ? "border-violet-500 bg-violet-50 text-violet-700 dark:border-violet-400/50 dark:bg-violet-500/15 dark:text-violet-200" : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/[0.06]")}>{config.flag}<span>{config.nativeLabel}</span>{currentLang === value && <Check className="ml-auto h-3.5 w-3.5" />}</button>
                ))}
              </div>
            </div>
            <div className="mx-1 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-white/[0.06]">
              <span className="flex items-center gap-2 text-xs font-semibold">{isDark ? <Moon className="h-4 w-4 text-violet-400" /> : <Sun className="h-4 w-4 text-amber-500" />}{isDark ? getTranslation("manage.common.darkMode") : getTranslation("manage.common.lightMode")}</span>
              <Switch aria-label={isDark ? getTranslation("manage.common.darkMode") : getTranslation("manage.common.lightMode")} checked={isDark} onCheckedChange={onThemeChange} className="h-5 w-9 border-0 bg-slate-300 data-[state=checked]:bg-violet-600 dark:bg-slate-600" />
            </div>
            <ManagePushNotificationSwitch className="mx-1 mt-2" />
            {canCreateWorkspace ? (
              <DropdownMenuItem asChild className="mt-2 cursor-pointer rounded-xl px-3 py-2.5 text-xs font-semibold text-violet-700 focus:bg-violet-50 focus:text-violet-800 dark:text-violet-200 dark:focus:bg-violet-500/10 dark:focus:text-violet-100"><Link href="/onboarding/workspace"><Plus className="h-4 w-4" />{getTranslation("manage.common.createWorkspace")}</Link></DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={requestWorkspaceCreation} className="mt-2 cursor-pointer rounded-xl px-3 py-2.5 text-xs font-semibold text-violet-700 focus:bg-violet-50 focus:text-violet-800 dark:text-violet-200 dark:focus:bg-violet-500/10 dark:focus:text-violet-100"><Plus className="h-4 w-4" />{getTranslation("manage.common.createWorkspace")}</DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => window.dispatchEvent(new Event("saas-core-manage-sign-out"))} className="mt-2 cursor-pointer rounded-xl px-3 py-2.5 text-xs font-semibold text-rose-600 focus:bg-rose-50 focus:text-rose-700 dark:text-rose-300 dark:focus:bg-rose-500/10 dark:focus:text-rose-200"><LogOut className="h-4 w-4" />{getTranslation("manage.common.signOut")}</DropdownMenuItem>
          </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
    )
  }

  return (
    <>
      <Sheet open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
        <SheetContent side="left" className="h-[100dvh] w-[min(20rem,86vw)] border-0 bg-transparent p-0 shadow-2xl">
          <SheetTitle className="sr-only">{getTranslation("common.navigationMenu")}</SheetTitle>
          <SheetDescription className="sr-only">{getTranslation(hasWorkspaceScope ? "manage.common.workspaceNavigation" : "manage.common.platformNavigation")}</SheetDescription>
          <div className={cn("h-full", isDark && "dark")}>
            {content(true)}
          </div>
        </SheetContent>
      </Sheet>
      <aside id="manage-sidebar-desktop" className={cn("manage-sidebar-desktop hidden h-dvh min-h-0 shrink-0 border-r border-slate-200/80 shadow-[10px_0_35px_rgba(15,23,42,0.025)] transition-[width] duration-300 dark:border-white/10 md:flex", isCollapsed ? "manage-sidebar-desktop-collapsed w-[3.75rem]" : "manage-sidebar-desktop-expanded w-[17rem]")}>{content()}</aside>
      <WorkspaceUpgradeModal
        open={workspaceUpgradeOpen}
        onOpenChange={setWorkspaceUpgradeOpen}
        currentPlan={currentWorkspace?.plan?.name || getTranslation("manage.common.workspace")}
        currentWorkspaceName={currentWorkspace?.workspace?.name}
        currentWorkspaceId={currentWorkspace?.id}
        ownedWorkspaceId={ownedWorkspaceId}
        workspaceLimit={typeof currentWorkspace?.plan?.limits?.["core.workspaces"] === "number" ? currentWorkspace.plan.limits["core.workspaces"] : null}
      />
    </>
  )
}
