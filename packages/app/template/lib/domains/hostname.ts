export const PLATFORM_HOST_LABELS = new Set([
  "www", "app", "api", "mcp", "docs", "admin", "manage", "login", "signup",
  "pricing", "help", "support", "status", "mail", "assets", "static",
])

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

export class HostnameValidationError extends Error {
  constructor(message: string) { super(message); this.name = "HostnameValidationError" }
}

function configuredRootDomain() {
  return (process.env.SAAS_CORE_ROOT_DOMAIN || "saas.example.com").trim().toLowerCase().replace(/^\.+|\.+$/g, "")
}
function configuredAppDomain() {
  return (process.env.SAAS_CORE_APP_DOMAIN || `app.${configuredRootDomain()}`).trim().toLowerCase().replace(/^\.+|\.+$/g, "")
}
function isDevelopmentTunnel(hostname: string) { return process.env.NODE_ENV !== "production" && [".ngrok-free.dev", ".ngrok.app", ".ngrok.io", ".nip.io"].some((suffix) => hostname.endsWith(suffix)) }
function isIPv4(value: string) {
  const parts = value.split(".")
  return parts.length === 4 && parts.every((part) => /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255)
}
function isPrivateIPv4(value: string) {
  if (!isIPv4(value)) return false
  const [first, second] = value.split(".").map(Number)
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168)
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

export function normalizeHostname(value: string) {
  const hostname = parseHostname(value, false)
  if (!hostname) throw new HostnameValidationError("Enter a valid hostname such as app.example.com.")
  const root = configuredRootDomain()
  if (hostname === root || hostname === `www.${root}` || hostname === configuredAppDomain() || hostname.endsWith(`.${root}`)) throw new HostnameValidationError("Platform hostnames cannot be connected as customer domains.")
  return hostname
}
export function tryNormalizeHostname(value: string) { try { return normalizeHostname(value) } catch { return null } }
export function normalizeDnsTarget(value: string) { const hostname = parseHostname(value, false); return hostname && !isIpAddress(hostname) ? hostname : null }
export function getCustomerHostnameParts(value: string): CustomerHostnameParts | null {
  const hostname = parseHostname(value, false)
  if (!hostname) return null
  const labels = hostname.split(".")
  return { hostname, isApex: labels.length <= 2, dnsHost: labels.length <= 2 ? "@" : labels.slice(0, -2).join(".") }
}
export function isPlatformOwnedHostname(value: string) {
  const hostname = parseHostname(value, true)
  if (!hostname) return false
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
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1" || (process.env.NODE_ENV !== "production" && isPrivateIPv4(hostname)) || isDevelopmentTunnel(hostname)) return { kind: "LOCAL_DEVELOPMENT", hostname, workspaceSlug: null }
  if (hostname.endsWith(".vercel.app") || hostname.endsWith(".vercel.sh")) return { kind: "VERCEL_PREVIEW", hostname, workspaceSlug: null }
  if (hostname.endsWith(`.${root}`)) {
    const labels = hostname.slice(0, -(root.length + 1)).split(".")
    if (labels.length === 1 && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(labels[0]) && !PLATFORM_HOST_LABELS.has(labels[0])) return { kind: "HOSTED_WORKSPACE", hostname, workspaceSlug: labels[0] }
    return { kind: "UNKNOWN", hostname, workspaceSlug: null, reason: "platform-host-label" }
  }
  return { kind: "CUSTOM_WORKSPACE", hostname, workspaceSlug: null }
}
export function getTrustedPlatformOrigin(kind: "root" | "app") {
  const hostname = kind === "app" ? configuredAppDomain() : configuredRootDomain()
  const isLocal = hostname === "localhost" || hostname.endsWith(".localhost")
  return `${isLocal ? "http" : "https"}://${hostname}`
}
export function getConfiguredRootDomain() { return configuredRootDomain() }
export function getConfiguredAppDomain() { return configuredAppDomain() }
