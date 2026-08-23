import { CoreError } from "./errors.js"

export function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase()
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new CoreError("CONFIGURATION_ERROR", "Enter a valid email address.")
  }
  return email
}

export function normalizeSlug(value: string): string {
  const slug = value.trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  if (!slug || slug.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) {
    throw new CoreError("CONFIGURATION_ERROR", "Use a URL-safe workspace slug.")
  }
  return slug
}

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

function validHostname(hostname: string): boolean {
  return hostname.length <= 253 && hostname.split(".").every((label) => HOST_LABEL.test(label))
}

function isIp(hostname: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":")
}

export function normalizeHostname(value: string, options: {
  rootDomain?: string
  appDomain?: string
  allowLocalhost?: boolean
} = {}): string {
  const raw = value.trim()
  if (!raw || /[\s#?*]/.test(raw) || (!raw.includes("://") && raw.includes("/"))) {
    throw new CoreError("DOMAIN_ERROR", "Enter a valid hostname.")
  }
  let parsed: URL
  try {
    parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    throw new CoreError("DOMAIN_ERROR", "Enter a valid hostname.")
  }
  if (!(["http:", "https:"].includes(parsed.protocol)) || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new CoreError("DOMAIN_ERROR", "Only a hostname is allowed.")
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "")
  if (!validHostname(hostname) || isIp(hostname)) throw new CoreError("DOMAIN_ERROR", "IP addresses are not valid customer domains.")
  if (!options.allowLocalhost && (hostname === "localhost" || hostname.endsWith(".localhost"))) {
    throw new CoreError("DOMAIN_ERROR", "Localhost cannot be connected as a customer domain.")
  }
  const root = options.rootDomain?.toLowerCase().replace(/^\.+|\.+$/g, "")
  const app = options.appDomain?.toLowerCase().replace(/^\.+|\.+$/g, "")
  if (root && (hostname === root || hostname === `www.${root}` || hostname.endsWith(`.${root}`) || hostname === app)) {
    throw new CoreError("DOMAIN_ERROR", "Platform-owned hostnames cannot be connected.")
  }
  return hostname
}

export function hostnameParts(hostname: string): { hostname: string; isApex: boolean; dnsHost: string } {
  const normalized = normalizeHostname(hostname)
  const labels = normalized.split(".")
  return { hostname: normalized, isApex: labels.length <= 2, dnsHost: labels.length <= 2 ? "@" : labels.slice(0, -2).join(".") }
}

export function normalizeJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {}
}
