export const PLATFORM_RESERVED_SLUGS = new Set([
  "www", "api", "app", "admin", "manage", "dashboard", "support", "help", "status",
  "auth", "login", "signup", "cdn", "assets", "static", "mail", "smtp", "ftp",
  "docs", "dev", "staging", "test", "mcp", "pricing",
])
export const PLATFORM_HOST_LABELS = new Set(PLATFORM_RESERVED_SLUGS)

export const DEVELOPMENT_NIP_IO_SUFFIX = ".nip.io"

export type HostnameKind =
  | "PLATFORM_ROOT"
  | "PLATFORM_WWW"
  | "PLATFORM_APP"
  | "HOSTED_WORKSPACE"
  | "CUSTOM_WORKSPACE"
  | "LOCAL_DEVELOPMENT"
  | "VERCEL_PREVIEW"
  | "UNKNOWN"

export type HostnameClassification = { kind: HostnameKind; hostname: string | null; workspaceSlug: string | null; reason?: string }
export type CustomerHostnameParts = { hostname: string; isApex: boolean; dnsHost: string }
export type TrustedRequestHost = { hostname: string; host: string }
export type HostnameNormalizationOptions = { allowPlatform?: boolean; allowDevelopment?: boolean }
export type DevelopmentHostnameParts = {
  hostname: string
  rootHostname: string
  ipAddress: string
  kind: "PLATFORM_ROOT" | "PLATFORM_WWW" | "PLATFORM_APP" | "HOSTED_WORKSPACE" | "RESERVED"
  workspaceSlug: string | null
}

export class HostnameValidationError extends Error {
  constructor(message: string) { super(message); this.name = "HostnameValidationError" }
}

function configuredRootDomain() {
  return (process.env.SAAS_CORE_ROOT_DOMAIN || "saas.example.com").trim().toLowerCase().replace(/^\.+|\.+$/g, "")
}
function configuredAppDomain() {
  return (process.env.SAAS_CORE_APP_DOMAIN || `app.${configuredRootDomain()}`).trim().toLowerCase().replace(/^\.+|\.+$/g, "")
}
export function isDevelopmentTunnelHostname(value: string) {
  const hostname = value.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "")
  return process.env.NODE_ENV !== "production" && ["ngrok-free.dev", "ngrok.app", "ngrok.io"].some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))
}
export function isDevelopmentLanHostname(value: string) {
  const hostname = value.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "")
  return process.env.NODE_ENV !== "production" && hostname.endsWith(".local")
}
export function isIPv4(value: string) {
  const parts = value.split(".")
  return parts.length === 4 && parts.every((part) => /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255)
}
export function isLoopbackIPv4(value: string) {
  return isIPv4(value) && Number(value.split(".")[0]) === 127
}
export function isPrivateIPv4(value: string) {
  if (!isIPv4(value)) return false
  const [first, second] = value.split(".").map(Number)
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168)
}
export function isDevelopmentIPv4(value: string) { return isLoopbackIPv4(value) || isPrivateIPv4(value) }
export function isNipIoHostname(value: string) {
  return value.trim().toLowerCase().replace(/\.$/, "").endsWith(DEVELOPMENT_NIP_IO_SUFFIX)
}
const WORKSPACE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
export const PLATFORM_SUBDOMAIN_SLUG_PATTERN = WORKSPACE_SLUG_PATTERN

export function isReservedPlatformSlug(value: string) {
  return PLATFORM_RESERVED_SLUGS.has(value.trim().toLowerCase())
}

export function normalizePlatformSubdomainSlug(value: string) {
  const slug = typeof value === "string" ? value.trim().toLowerCase() : ""
  if (!PLATFORM_SUBDOMAIN_SLUG_PATTERN.test(slug)) throw new HostnameValidationError("Use 1–63 lowercase letters, numbers, or hyphens for a subdomain.")
  if (isReservedPlatformSlug(slug)) throw new HostnameValidationError("That subdomain is reserved by the platform.")
  return slug
}

/**
 * Parse only the supported private/loopback dotted IPv4 nip.io forms. The
 * embedded IP is always the development root; a single leading label can be
 * the app host or a hosted Workspace slug.
 */
export function parseDevelopmentHostname(value: string): DevelopmentHostnameParts | null {
  const hostname = value.trim().toLowerCase().replace(/\.$/, "")
  if (!isNipIoHostname(hostname) || !isValidHostnameShape(hostname)) return null

  const withoutSuffix = hostname.slice(0, -DEVELOPMENT_NIP_IO_SUFFIX.length)
  const labels = withoutSuffix.split(".")
  const ipAddress = labels.slice(-4).join(".")
  if (!isDevelopmentIPv4(ipAddress)) return null

  const prefix = labels.slice(0, -4)
  const rootHostname = `${ipAddress}${DEVELOPMENT_NIP_IO_SUFFIX}`
  if (prefix.length === 0) return { hostname, rootHostname, ipAddress, kind: "PLATFORM_ROOT", workspaceSlug: null }
  if (prefix.length !== 1) return null

  const label = prefix[0]
  if (label === "www") return { hostname, rootHostname, ipAddress, kind: "PLATFORM_WWW", workspaceSlug: null }
  if (label === "app") return { hostname, rootHostname, ipAddress, kind: "PLATFORM_APP", workspaceSlug: null }
  if (PLATFORM_HOST_LABELS.has(label)) return { hostname, rootHostname, ipAddress, kind: "RESERVED", workspaceSlug: null }
  if (!WORKSPACE_SLUG_PATTERN.test(label)) return null
  return { hostname, rootHostname, ipAddress, kind: "HOSTED_WORKSPACE", workspaceSlug: label }
}

export function isDevelopmentNipIoHostname(value: string) { return Boolean(parseDevelopmentHostname(value)) }

/** Convert a raw private LAN IP into its reachable, hostname-shaped alias. */
export function toReachableDevelopmentHostname(value: string) {
  const hostname = value.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "")
  return isPrivateIPv4(hostname) ? `${hostname}${DEVELOPMENT_NIP_IO_SUFFIX}` : hostname
}

export function isLocalDevelopmentHostname(value: string | null | undefined) {
  const hostname = value?.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "") || ""
  return isLoopbackDevelopmentHostname(hostname) || isDevelopmentIPv4(hostname) || isDevelopmentNipIoHostname(hostname) || isDevelopmentLanHostname(hostname)
}

export function isLoopbackDevelopmentHostname(value: string | null | undefined) {
  const hostname = value?.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "") || ""
  return hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1" || hostname === "::1"
}
function isIpAddress(value: string) { return isIPv4(value) || value.includes(":") || value.startsWith("[") || value.endsWith("]") }
function isValidHostnameShape(value: string) {
  if (value.length < 1 || value.length > 253) return false
  return value.split(".").every((label) => label.length <= 63 && /^[a-z0-9-]+$/.test(label) && !label.startsWith("-") && !label.endsWith("-"))
}
function parseHostname(value: string, allowLocalhost: boolean, allowPrivateNetwork = false) {
  const raw = value.trim()
  const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(raw)
  if (!raw || /[\s#?*]/.test(raw) || (!hasScheme && raw.includes("/"))) return null
  let parsed: URL
  try { parsed = new URL(hasScheme ? raw : `http://${raw}`) } catch { return null }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return null
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "")
  if (!hostname || !isValidHostnameShape(hostname)) return null
  if (isIpAddress(hostname) && !((allowLocalhost && hostname === "127.0.0.1") || (allowPrivateNetwork && isPrivateIPv4(hostname)))) return null
  if (!allowLocalhost && (hostname === "localhost" || hostname.endsWith(".localhost"))) return null
  return hostname
}

function firstHeaderValue(headers: Pick<Headers, "get">, name: string) {
  return headers.get(name)?.split(",")[0]?.trim() || null
}

function parseTrustedRequestHost(value: string | null): TrustedRequestHost | null {
  const raw = value?.trim() || ""
  if (!raw || /^[a-z][a-z\d+.-]*:\/\//i.test(raw) || /[\\/\s?#]/.test(raw)) return null

  let parsed: URL
  try { parsed = new URL(`http://${raw}`) } catch { return null }
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return null

  const hostname = parseHostname(raw, true, process.env.NODE_ENV !== "production")
  if (!hostname || parsed.hostname.toLowerCase().replace(/\.$/, "") !== hostname) return null
  if (isNipIoHostname(hostname) && (process.env.NODE_ENV === "production" || !isDevelopmentNipIoHostname(hostname))) return null
  return { hostname, host: parsed.host }
}

/**
 * Resolve the request host once at the server boundary. Proxies may provide a
 * comma-separated forwarded chain; only its first value is considered, and a
 * malformed forwarded value falls back to the ordinary Host header.
 */
export function getTrustedHostFromHeaders(headers: Pick<Headers, "get">): TrustedRequestHost | null {
  for (const header of ["x-forwarded-host", "host"]) {
    const candidate = parseTrustedRequestHost(firstHeaderValue(headers, header))
    if (candidate) return candidate
  }
  return null
}

export function getTrustedRequestHost(request: Request) {
  return getTrustedHostFromHeaders(request.headers)
}

export function getRequestHostname(request: Request) {
  return getTrustedRequestHost(request)?.hostname || null
}

export function normalizeHostname(value: string, options: HostnameNormalizationOptions = {}) {
  const allowDevelopment = options.allowDevelopment === true && process.env.NODE_ENV !== "production"
  const hostname = parseHostname(value, allowDevelopment, allowDevelopment)
  if (!hostname) throw new HostnameValidationError("Enter a valid hostname such as app.example.com.")
  if (isNipIoHostname(hostname) && (!allowDevelopment || process.env.NODE_ENV === "production" || !isDevelopmentNipIoHostname(hostname))) throw new HostnameValidationError("nip.io development hosts cannot be connected as customer domains.")
  if (!options.allowPlatform) {
    const root = configuredRootDomain()
    if (hostname === root || hostname === `www.${root}` || hostname === configuredAppDomain() || hostname.endsWith(`.${root}`)) throw new HostnameValidationError("Platform hostnames cannot be connected as customer domains.")
  }
  return hostname
}
export function tryNormalizeHostname(value: string) { try { return normalizeHostname(value) } catch { return null } }
export function buildPlatformHostname(slug: string, rootDomain = configuredRootDomain()) {
  const normalizedSlug = normalizePlatformSubdomainSlug(slug)
  const normalizedRoot = parseHostname(rootDomain, false)
  if (!normalizedRoot || isIpAddress(normalizedRoot) || normalizedRoot.split(".").length < 2) {
    throw new HostnameValidationError("The platform root domain is not configured correctly.")
  }
  return `${normalizedSlug}.${normalizedRoot}`
}
export function normalizeDnsTarget(value: string) { const hostname = parseHostname(value, false); return hostname && !isIpAddress(hostname) ? hostname : null }
export function getCustomerHostnameParts(value: string): CustomerHostnameParts | null {
  const hostname = parseHostname(value, false)
  if (!hostname || isNipIoHostname(hostname)) return null
  const labels = hostname.split(".")
  return { hostname, isApex: labels.length <= 2, dnsHost: labels.length <= 2 ? "@" : labels.slice(0, -2).join(".") }
}
export function isPlatformOwnedHostname(value: string) {
  const hostname = parseHostname(value, true)
  if (!hostname) return false
  if (isNipIoHostname(hostname)) return process.env.NODE_ENV !== "production" && isDevelopmentNipIoHostname(hostname)
  const root = configuredRootDomain()
  return hostname === root || hostname === `www.${root}` || hostname === configuredAppDomain() || hostname.endsWith(`.${root}`)
}
export function classifyHostname(value: string): HostnameClassification {
  const hostname = parseHostname(value, true, process.env.NODE_ENV !== "production")
  if (!hostname) return { kind: "UNKNOWN", hostname: null, workspaceSlug: null, reason: "invalid-hostname" }
  const root = configuredRootDomain()
  if (hostname === root) return { kind: "PLATFORM_ROOT", hostname, workspaceSlug: null }
  if (hostname === `www.${root}`) return { kind: "PLATFORM_WWW", hostname, workspaceSlug: null }
  if (hostname === configuredAppDomain()) return { kind: "PLATFORM_APP", hostname, workspaceSlug: null }
  if (process.env.NODE_ENV !== "production") {
    const development = parseDevelopmentHostname(hostname)
    if (development) {
      if (development.kind === "RESERVED") return { kind: "UNKNOWN", hostname, workspaceSlug: null, reason: "platform-host-label" }
      return { kind: development.kind, hostname, workspaceSlug: development.workspaceSlug }
    }
  }
  if (isNipIoHostname(hostname)) return { kind: "UNKNOWN", hostname, workspaceSlug: null, reason: "unsupported-development-host" }
  if (isLocalDevelopmentHostname(hostname) || isDevelopmentTunnelHostname(hostname)) return { kind: "LOCAL_DEVELOPMENT", hostname, workspaceSlug: null }
  if (hostname.endsWith(".vercel.app") || hostname.endsWith(".vercel.sh")) return { kind: "VERCEL_PREVIEW", hostname, workspaceSlug: null }
  if (hostname.endsWith(`.${root}`)) {
    const labels = hostname.slice(0, -(root.length + 1)).split(".")
    if (labels.length === 1 && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(labels[0]) && !PLATFORM_HOST_LABELS.has(labels[0])) return { kind: "HOSTED_WORKSPACE", hostname, workspaceSlug: labels[0] }
    return { kind: "UNKNOWN", hostname, workspaceSlug: null, reason: "platform-host-label" }
  }
  return { kind: "CUSTOM_WORKSPACE", hostname, workspaceSlug: null }
}
export type TrustedPlatformOriginOptions = { requestHost?: string | null }

function developmentRequestHost(value: string | null | undefined) {
  const candidates = [value, process.env.APP_URL, process.env.NEXT_PUBLIC_APP_URL]
  for (const [index, candidate] of candidates.entries()) {
    const raw = candidate?.trim() || ""
    const configuredOrigin = index > 0 && /^[a-z][a-z\d+.-]*:\/\//i.test(raw)
    if (!raw || (!configuredOrigin && /^[a-z][a-z\d+.-]*:\/\//i.test(raw)) || (!configuredOrigin && /[\\/\s?#]/.test(raw))) continue
    try {
      const parsed = new URL(configuredOrigin ? raw : `http://${raw}`)
      if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) continue
      const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "")
      const development = parseDevelopmentHostname(hostname)
      const rootHostname = development?.rootHostname
        || (isPrivateIPv4(hostname) ? `${hostname}${DEVELOPMENT_NIP_IO_SUFFIX}` : null)
        || (isLoopbackDevelopmentHostname(hostname) ? "127.0.0.1.nip.io" : null)
      if (rootHostname) return { rootHostname, port: parsed.port }
    } catch {
      continue
    }
  }
  return null
}

export function getDevelopmentPlatformOrigin(kind: "root" | "app", requestHost?: string | null) {
  if (process.env.NODE_ENV === "production") return null
  const development = developmentRequestHost(requestHost)
  if (!development) return null
  const hostname = kind === "app" ? `app.${development.rootHostname}` : development.rootHostname
  return `http://${hostname}${development.port ? `:${development.port}` : ""}`
}

export function getTrustedPlatformOrigin(kind: "root" | "app", options: TrustedPlatformOriginOptions = {}) {
  const developmentOrigin = getDevelopmentPlatformOrigin(kind, options.requestHost)
  if (developmentOrigin) return developmentOrigin
  const hostname = kind === "app" ? configuredAppDomain() : configuredRootDomain()
  const isLocal = process.env.NODE_ENV !== "production" && isLocalDevelopmentHostname(hostname)
  return `${isLocal ? "http" : "https"}://${hostname}`
}

/**
 * Build a reachable public origin from an authoritative Core platform host.
 * Local development keeps the persisted Core hostname as the source of the
 * label, while the request host supplies the reachable nip.io root and port.
 */
export function getPlatformWorkspaceOrigin(workspaceHostname: string, options: TrustedPlatformOriginOptions = {}) {
  let normalizedHostname: string
  try {
    normalizedHostname = normalizeHostname(workspaceHostname, { allowPlatform: true, allowDevelopment: process.env.NODE_ENV !== "production" })
  } catch {
    return null
  }

  if (process.env.NODE_ENV === "production") return `https://${normalizedHostname}`
  const rootOrigin = getDevelopmentPlatformOrigin("root", options.requestHost)
  if (!rootOrigin) return null
  const suffix = `.${configuredRootDomain()}`
  if (!normalizedHostname.endsWith(suffix)) return null
  const label = normalizedHostname.slice(0, -suffix.length)
  if (!label || label.includes(".")) return null
  try {
    const origin = new URL(rootOrigin)
    origin.hostname = `${label}.${origin.hostname}`
    return origin.origin
  } catch {
    return null
  }
}

export function getConfiguredRootDomain() { return configuredRootDomain() }
export function getConfiguredAppDomain() { return configuredAppDomain() }
