import { PRODUCT_CONFIG } from "./product-config"

export const CORE_RESERVED_APP_ROUTES = [
  "/app",
  "/app/team",
  "/app/plan",
  "/app/domains",
  "/app/pwa",
  "/app/settings",
  "/app/setup",
] as const

export const CORE_WORKSPACE_ROLES = ["owner", "admin", "manager", "staff", "readonly"] as const

export type ProductShellRole = (typeof CORE_WORKSPACE_ROLES)[number]

export type ProductShellNavigationItem = {
  key: string
  label: string
  href: string
  icon: string
  match: "exact" | "prefix"
  workspaceRoles?: readonly ProductShellRole[]
  requiredFeature?: string
}

export type ResolvedProductShell = {
  homePath: string
  homeLabel: string | null
  navigation: readonly ProductShellNavigationItem[]
}

const DEFAULT_HOME_PATH = "/app"
const DEFAULT_ICON = "layers"
const PRODUCT_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/
const FEATURE_KEY_PATTERN = /^[a-z][a-zA-Z0-9_.:-]{0,95}$/
const KNOWN_ICON_KEYS = new Set([
  "activity",
  "archive",
  "bar-chart",
  "briefcase",
  "calendar",
  "file",
  "folder",
  "layers",
  "list",
  "package",
  "settings",
  "users",
])

function normalizeInternalAppPath(value: unknown) {
  if (typeof value !== "string") return null
  const path = value.trim()
  if (!path || path.length > 160 || /[\u0000-\u001f\u007f\\?#]/.test(path) || path.includes("//")) return null
  if (path !== "/app" && !path.startsWith("/app/")) return null
  if (path.split("/").some((segment) => segment === "." || segment === "..")) return null
  return path.replace(/\/$/, "") || "/app"
}

function isValidRole(value: unknown): value is ProductShellRole {
  return typeof value === "string" && (CORE_WORKSPACE_ROLES as readonly string[]).includes(value)
}

export function isCoreReservedAppPath(path: string) {
  return CORE_RESERVED_APP_ROUTES.some((reserved) => path === reserved || (reserved !== "/app" && path.startsWith(`${reserved}/`)))
}

function normalizeIcon(value: unknown) {
  return typeof value === "string" && KNOWN_ICON_KEYS.has(value) ? value : DEFAULT_ICON
}

function normalizeHomePath(value: unknown) {
  const path = normalizeInternalAppPath(value) || DEFAULT_HOME_PATH
  return path === DEFAULT_HOME_PATH || isCoreReservedAppPath(path) ? DEFAULT_HOME_PATH : path
}

function normalizeNavigation(value: unknown, homePath: string): readonly ProductShellNavigationItem[] {
  if (!Array.isArray(value)) return []
  const seenKeys = new Set<string>()
  const seenHrefs = new Set<string>()
  const navigation: ProductShellNavigationItem[] = []
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue
    const item = candidate as Record<string, unknown>
    const key = typeof item.key === "string" ? item.key.trim() : ""
    const label = typeof item.label === "string" ? item.label.trim() : ""
    const href = normalizeInternalAppPath(item.href)
    if (!PRODUCT_KEY_PATTERN.test(key) || !label || label.length > 80 || !href || href === homePath || isCoreReservedAppPath(href) || seenKeys.has(key) || seenHrefs.has(href)) continue
    const workspaceRoles = Array.isArray(item.workspaceRoles) ? item.workspaceRoles.filter(isValidRole) : undefined
    if (Array.isArray(item.workspaceRoles) && (!workspaceRoles || workspaceRoles.length === 0)) continue
    const requiredFeature = item.requiredFeature === undefined ? undefined : typeof item.requiredFeature === "string" && FEATURE_KEY_PATTERN.test(item.requiredFeature) ? item.requiredFeature : null
    if (requiredFeature === null) continue
    seenKeys.add(key)
    seenHrefs.add(href)
    navigation.push({
      key,
      label,
      href,
      icon: normalizeIcon(item.icon),
      match: item.match === "prefix" ? "prefix" : "exact",
      ...(workspaceRoles?.length ? { workspaceRoles } : {}),
      ...(requiredFeature ? { requiredFeature } : {}),
    })
  }
  return navigation
}

export function resolveProductShellConfig(config: unknown): ResolvedProductShell {
  const shell = config && typeof config === "object" && "shell" in config
    ? (config as { shell?: unknown }).shell
    : undefined
  const values = shell && typeof shell === "object" ? shell as Record<string, unknown> : {}
  const homePath = normalizeHomePath(values.homePath)
  const homeLabel = typeof values.homeLabel === "string" && values.homeLabel.trim() && values.homeLabel.trim().length <= 80 ? values.homeLabel.trim() : null
  return { homePath, homeLabel, navigation: normalizeNavigation(values.navigation, homePath) }
}

export function resolveProductShell(): ResolvedProductShell {
  return resolveProductShellConfig(PRODUCT_CONFIG as unknown)
}

export function getProductHomePath() {
  return resolveProductShell().homePath
}

export function matchesProductNavigation(pathname: string, item: ProductShellNavigationItem) {
  return item.match === "prefix" ? pathname === item.href || pathname.startsWith(`${item.href}/`) : pathname === item.href
}

export function getActiveProductNavigationKey(pathname: string, navigation: readonly ProductShellNavigationItem[]) {
  if (isCoreReservedAppPath(pathname)) return null
  return navigation
    .filter((item) => matchesProductNavigation(pathname, item))
    .sort((left, right) => right.href.length - left.href.length)[0]?.key || null
}

export function isProductHomeActive(pathname: string, homePath: string) {
  return pathname === homePath
}

export function isProductNavigationVisible(item: ProductShellNavigationItem, role: string | null | undefined, features: Readonly<Record<string, boolean>> | null | undefined) {
  if (item.workspaceRoles?.length && (!role || !item.workspaceRoles.includes(role as ProductShellRole))) return false
  if (item.requiredFeature && features?.[item.requiredFeature] !== true) return false
  return true
}
