import { isDevelopmentTunnelHostname, isLocalDevelopmentHostname, isLoopbackDevelopmentHostname, toReachableDevelopmentHostname } from "@/lib/domains/hostname"

export const DEV_MAILPIT_PROXY_PATH = "/api/dev/mailpit"
const DEFAULT_MAILPIT_PORT = "55524"

function localMailpitOrigin(hostname: string) {
  const reachableHost = toReachableDevelopmentHostname(hostname)
  const host = reachableHost.includes(":") ? `[${reachableHost}]` : reachableHost
  return `http://${host}:${DEFAULT_MAILPIT_PORT}`
}

/**
 * Mailpit is a local development aid, never a production integration.
 * A configured URL is intentionally public because it points to a local inbox,
 * not to a provider credential. The production guard remains the first check.
 */
export function getDevMailpitUrl(hostname?: string | null) {
  if (process.env.NODE_ENV === "production") return null
  const configured = process.env.NEXT_PUBLIC_DEV_MAILPIT_URL?.trim()
  const currentHost = hostname?.trim() || ""
  const currentHostNormalized = currentHost.toLowerCase().replace(/^\[|\]$/g, "")
  const fallback = isLocalDevelopmentHostname(currentHost) ? localMailpitOrigin(currentHost) : null

  // A loopback URL is useful on the development machine but points back to a
  // phone when the app is reached through an Ngrok tunnel. Keep the inbox on
  // the app origin so the browser never has to resolve the developer's
  // localhost itself.
  if (isDevelopmentTunnelHostname(currentHostNormalized)) {
    if (!configured) return DEV_MAILPIT_PROXY_PATH
    try {
      const configuredUrl = new URL(configured)
      if (isLoopbackDevelopmentHostname(configuredUrl.hostname)) return DEV_MAILPIT_PROXY_PATH
    } catch {
      return null
    }
  }

  const candidate = configured || fallback
  if (!candidate) return null
  try {
    const url = new URL(candidate)
    if (!["http:", "https:"].includes(url.protocol)) return null

    // A copied .env.example commonly leaves Mailpit on localhost. When the
    // app is opened through a private LAN address, that loopback URL points
    // back to the phone/browser instead of the development machine.
    const configuredHost = url.hostname.toLowerCase().replace(/^\[|\]$/g, "")
    if (configured && fallback && isLoopbackDevelopmentHostname(configuredHost) && configuredHost !== currentHostNormalized) {
      url.hostname = toReachableDevelopmentHostname(currentHostNormalized)
      return url.toString().replace(/\/$/, "")
    }

    return url.toString().replace(/\/$/, "")
  } catch {
    return null
  }
}
