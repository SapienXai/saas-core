export const PLATFORM_HOST_LABELS = new Set([
  "www",
  "app",
  "api",
  "mcp",
  "docs",
  "admin",
  "manage",
  "login",
  "signup",
  "pricing",
  "help",
  "support",
  "status",
  "mail",
  "assets",
  "static",
])

export type HostnameKind =
  | "PLATFORM_ROOT"
  | "PLATFORM_WWW"
  | "PLATFORM_APP"
  | "HOSTED_RESTAURANT"
  | "CUSTOM_RESTAURANT"
  | "LOCAL_DEVELOPMENT"
  | "VERCEL_PREVIEW"
  | "UNKNOWN"

export type HostnameClassification = {
  kind: HostnameKind
  hostname: string | null
  restaurantSlug: string | null
  reason?: string
}

export type CustomerHostnameParts = {
  hostname: string
  isApex: boolean
  dnsHost: string
}

export class HostnameValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "HostnameValidationError"
  }
}

function configuredRootDomain() {
  return (process.env.RESERVEVIA_ROOT_DOMAIN || "reservevia.com").trim().toLowerCase().replace(/^\.+|\.+$/g, "")
}

function configuredAppDomain() {
  return (process.env.RESERVEVIA_APP_DOMAIN || `app.${configuredRootDomain()}`).trim().toLowerCase().replace(/^\.+|\.+$/g, "")
}

function isDevelopmentTunnel(hostname: string) {
  if (process.env.NODE_ENV === "production") return false
  return hostname.endsWith(".ngrok-free.dev") || hostname.endsWith(".ngrok.app") || hostname.endsWith(".ngrok.io")
}

function isIPv4(value: string) {
  const parts = value.split(".")
  return parts.length === 4 && parts.every((part) => /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255)
}

function isPrivateIPv4(value: string) {
  if (!isIPv4(value)) return false
  const [first, second] = value.split(".").map(Number)
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168)
}

function isIpAddress(value: string) {
  return isIPv4(value) || value.includes(":") || value.startsWith("[") || value.endsWith("]")
}

function isValidHostnameShape(value: string) {
  if (value.length > 253 || value.length < 1) return false
  const labels = value.split(".")
  return labels.every((label) => (
    label.length >= 1 &&
    label.length <= 63 &&
    /^[a-z0-9-]+$/.test(label) &&
    !label.startsWith("-") &&
    !label.endsWith("-")
  ))
}

function parseHostname(value: string, allowLocalhost: boolean, allowPrivateNetwork = false) {
  const raw = value.trim()
  const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(raw)
  if (!raw || /[\s#?*]/.test(raw) || (!hasScheme && raw.includes("/"))) return null

  let parsed: URL
  try {
    parsed = new URL(hasScheme ? raw : `http://${raw}`)
  } catch {
    return null
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
  if (parsed.username || parsed.password) return null
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) return null

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "")
  if (!hostname || !isValidHostnameShape(hostname)) return null
  if (isIpAddress(hostname) && !(
    (allowLocalhost && hostname === "127.0.0.1") ||
    (allowPrivateNetwork && isPrivateIPv4(hostname))
  )) return null
  if (!allowLocalhost && (hostname === "localhost" || hostname.endsWith(".localhost"))) return null
  return hostname
}

/**
 * Normalize a user-entered customer hostname. This is the only public-domain
 * normalization entry point used by management actions.
 */
export function normalizeHostname(value: string) {
  const hostname = parseHostname(value, false)
  if (!hostname) {
    throw new HostnameValidationError("Enter a valid hostname such as reserve.example.com.")
  }

  const root = configuredRootDomain()
  const app = configuredAppDomain()
  if (
    hostname === root ||
    hostname === `www.${root}` ||
    hostname === app ||
    hostname.endsWith(`.${root}`)
  ) {
    throw new HostnameValidationError("Reservevia platform hostnames cannot be connected as customer domains.")
  }

  return hostname
}

export function tryNormalizeHostname(value: string) {
  try {
    return normalizeHostname(value)
  } catch {
    return null
  }
}

/**
 * Normalize a DNS target from trusted server configuration. Unlike a
 * customer-owned hostname, a target may intentionally live below the
 * Reservevia root domain (for example cname.reservevia.com).
 */
export function normalizeDnsTarget(value: string) {
  const hostname = parseHostname(value, false)
  if (!hostname || isIpAddress(hostname)) return null
  return hostname
}

/**
 * Return the DNS provider name for a customer hostname. Reservevia currently
 * supports standard registrable domains (the final two labels) and therefore
 * treats a two-label hostname as an apex domain.
 */
export function getCustomerHostnameParts(value: string): CustomerHostnameParts | null {
  const hostname = parseHostname(value, false)
  if (!hostname) return null
  const labels = hostname.split(".")
  const isApex = labels.length <= 2
  return {
    hostname,
    isApex,
    dnsHost: isApex ? "@" : labels.slice(0, -2).join("."),
  }
}

export function isPlatformOwnedHostname(value: string) {
  const hostname = parseHostname(value, true)
  if (!hostname) return false
  const root = configuredRootDomain()
  const app = configuredAppDomain()
  return hostname === root || hostname === `www.${root}` || hostname === app || hostname.endsWith(`.${root}`)
}

export function classifyHostname(value: string): HostnameClassification {
  const hostname = parseHostname(value, true, process.env.NODE_ENV !== "production")
  if (!hostname) return { kind: "UNKNOWN", hostname: null, restaurantSlug: null, reason: "invalid-hostname" }

  const root = configuredRootDomain()
  const app = configuredAppDomain()
  if (hostname === root) return { kind: "PLATFORM_ROOT", hostname, restaurantSlug: null }
  if (hostname === `www.${root}`) return { kind: "PLATFORM_WWW", hostname, restaurantSlug: null }
  if (hostname === app) return { kind: "PLATFORM_APP", hostname, restaurantSlug: null }

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    const labels = hostname.split(".")
    if (labels.length === 2 && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(labels[0])) {
      return { kind: "HOSTED_RESTAURANT", hostname, restaurantSlug: labels[0] }
    }
    return { kind: "LOCAL_DEVELOPMENT", hostname, restaurantSlug: null }
  }

  if (hostname === "127.0.0.1") {
    return { kind: "LOCAL_DEVELOPMENT", hostname, restaurantSlug: null }
  }

  if (process.env.NODE_ENV !== "production" && isPrivateIPv4(hostname)) {
    return { kind: "LOCAL_DEVELOPMENT", hostname, restaurantSlug: null }
  }

  if (isDevelopmentTunnel(hostname)) {
    return { kind: "LOCAL_DEVELOPMENT", hostname, restaurantSlug: null }
  }

  if (hostname.endsWith(".vercel.app") || hostname.endsWith(".vercel.sh")) {
    return { kind: "VERCEL_PREVIEW", hostname, restaurantSlug: null }
  }

  if (hostname.endsWith(`.${root}`)) {
    const labels = hostname.slice(0, -(root.length + 1)).split(".")
    if (labels.length === 1 && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(labels[0])) {
      if (PLATFORM_HOST_LABELS.has(labels[0])) {
        return { kind: "UNKNOWN", hostname, restaurantSlug: null, reason: "platform-host-label" }
      }
      return { kind: "HOSTED_RESTAURANT", hostname, restaurantSlug: labels[0] }
    }
    return { kind: "UNKNOWN", hostname, restaurantSlug: null, reason: "nested-platform-host" }
  }

  if (isValidHostnameShape(hostname)) {
    return { kind: "CUSTOM_RESTAURANT", hostname, restaurantSlug: null }
  }

  return { kind: "UNKNOWN", hostname, restaurantSlug: null, reason: "unsupported-hostname" }
}

export function getTrustedPlatformOrigin(kind: "root" | "app") {
  const hostname = kind === "app" ? configuredAppDomain() : configuredRootDomain()
  const isLocal = hostname === "localhost" || hostname.endsWith(".localhost")
  return `${isLocal ? "http" : "https"}://${hostname}`
}

export function getConfiguredRootDomain() {
  return configuredRootDomain()
}

export function getConfiguredAppDomain() {
  return configuredAppDomain()
}
