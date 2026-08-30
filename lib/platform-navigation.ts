import { PLATFORM_ROLES, type PlatformRole } from "./platform-types"
import { PRODUCT_CONFIG } from "./product-config"

export type PlatformNavigationItem = { key: string; label: string; href: string; icon: string; match: "exact" | "prefix"; platformRoles?: readonly PlatformRole[]; legacyPaths?: readonly string[] }
const DEFAULT_PLATFORM_NAVIGATION: readonly PlatformNavigationItem[] = [
  { key: "overview", label: "Overview", href: "/platform", icon: "layout-dashboard", match: "exact" },
  { key: "workspaces", label: "Workspaces", href: "/platform/workspaces", icon: "briefcase", match: "prefix" },
  { key: "users", label: "Users", href: "/platform/users", icon: "users", match: "prefix" },
  { key: "billing", label: "Billing", href: "/platform/billing", icon: "wallet-cards", match: "prefix", platformRoles: ["platform_owner", "billing_admin"] },
  { key: "domains", label: "Domains", href: "/platform/domains", icon: "globe", match: "prefix" },
  { key: "health", label: "Health", href: "/platform/health", icon: "activity", match: "prefix" },
  { key: "audit", label: "Audit", href: "/platform/audit", icon: "file", match: "prefix" },
]
const PLATFORM_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/
const PLATFORM_PATH_PATTERN = /^\/platform(?:\/[a-zA-Z0-9._~!$&'()*+,;=:@%-]+)*$/
const INTERNAL_PATH_PATTERN = /^\/[a-zA-Z0-9._~!$&'()*+,;=:@%-]+(?:\/[a-zA-Z0-9._~!$&'()*+,;=:@%-]+)*$/
function normalizePlatformNavigationItem(candidate: unknown): PlatformNavigationItem | null {
  if (!candidate || typeof candidate !== "object") return null
  const item = candidate as Record<string, unknown>
  const key = typeof item.key === "string" ? item.key.trim() : ""
  const label = typeof item.label === "string" ? item.label.trim() : ""
  const href = typeof item.href === "string" ? item.href.trim().replace(/\/$/, "") || "/platform" : ""
  if (!PLATFORM_KEY_PATTERN.test(key) || !label || label.length > 80 || !PLATFORM_PATH_PATTERN.test(href)) return null
  const platformRoles = Array.isArray(item.platformRoles) ? item.platformRoles.filter((role): role is PlatformRole => typeof role === "string" && PLATFORM_ROLES.includes(role as PlatformRole)) : undefined
  if (Array.isArray(item.platformRoles) && !platformRoles?.length) return null
  const legacyPaths = Array.isArray(item.legacyPaths)
    ? [...new Set(item.legacyPaths.filter((path): path is string => typeof path === "string").map((path) => path.trim().replace(/\/$/, "")).filter((path) => INTERNAL_PATH_PATTERN.test(path) && path !== href))].slice(0, 8)
    : []
  return { key, label, href, icon: typeof item.icon === "string" && item.icon.trim() ? item.icon.trim() : "layers", match: item.match === "prefix" ? "prefix" : "exact", ...(platformRoles?.length ? { platformRoles } : {}), ...(legacyPaths.length ? { legacyPaths } : {}) }
}
export function resolvePlatformNavigationConfig(config: unknown): readonly PlatformNavigationItem[] {
  const values = config && typeof config === "object" && Array.isArray((config as { platformNavigation?: unknown }).platformNavigation) ? (config as { platformNavigation: unknown[] }).platformNavigation : []
  const resolved: PlatformNavigationItem[] = []; const seenKeys = new Set<string>(); const seenHrefs = new Set<string>()
  for (const candidate of [...DEFAULT_PLATFORM_NAVIGATION, ...values]) { const item = normalizePlatformNavigationItem(candidate); if (!item || seenKeys.has(item.key) || seenHrefs.has(item.href)) continue; seenKeys.add(item.key); seenHrefs.add(item.href); resolved.push(item) }
  return resolved
}
export function resolvePlatformNavigation() { return resolvePlatformNavigationConfig(PRODUCT_CONFIG as unknown) }
export function matchesPlatformNavigation(pathname: string, item: PlatformNavigationItem) { return [item.href, ...(item.legacyPaths || [])].some((basePath) => item.match === "prefix" ? pathname === basePath || pathname.startsWith(`${basePath}/`) : pathname === basePath) }
export function getActivePlatformNavigationKey(pathname: string, navigation: readonly PlatformNavigationItem[]) { const matching = navigation.filter((item) => matchesPlatformNavigation(pathname, item)); return matching.sort((left, right) => { const leftLength = [left.href, ...(left.legacyPaths || [])].filter((path) => pathname === path || pathname.startsWith(`${path}/`)).sort((a, b) => b.length - a.length)[0]?.length || 0; const rightLength = [right.href, ...(right.legacyPaths || [])].filter((path) => pathname === path || pathname.startsWith(`${path}/`)).sort((a, b) => b.length - a.length)[0]?.length || 0; return rightLength - leftLength })[0]?.key || null }
export function isPlatformNavigationVisible(item: PlatformNavigationItem, role: string | null | undefined) { return !item.platformRoles?.length || (typeof role === "string" && item.platformRoles.includes(role as PlatformRole)) }
