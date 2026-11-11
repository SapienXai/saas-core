import { getTrustedRequestHost, toReachableDevelopmentHostname } from "@/lib/domains/hostname"

/**
 * Next's development server can build request.url from its bind address
 * (0.0.0.0) instead of the hostname used by a device on the local network.
 * Keep auth redirects on the browser's reachable host in development.
 */
export function getRequestUrl(request: Request) {
  const url = new URL(request.url)

  if (process.env.NODE_ENV === "production") return url

  const forwardedProtocol = process.env.SAAS_CORE_TRUST_FORWARDED_HOST === "true"
    ? firstHeaderValue(request, "x-forwarded-proto") : null
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https"
    ? forwardedProtocol : url.protocol.replace(":", "")
  const trustedHost = getTrustedRequestHost(request)
  const origin = originFromHost(trustedHost?.host || null, protocol)
  if (origin) return new URL(`${url.pathname}${url.search}${url.hash}`, `${origin}/`)

  return url
}

/**
 * GoTrue rejects decimal non-loopback IPs as redirect targets, even when they
 * are present in the URI allow-list. In local development, use the equivalent
 * nip.io hostname so a phone or another device still reaches this machine.
 */
export function getAuthRedirectOrigin(origin: string) {
  const url = new URL(origin)
  if (process.env.NODE_ENV === "production") return url.origin

  url.hostname = toReachableDevelopmentHostname(url.hostname)
  return url.origin
}

export function getAuthRedirectUrl(request: Request) {
  const url = getRequestUrl(request)
  const origin = getAuthRedirectOrigin(url.origin)
  return new URL(`${url.pathname}${url.search}${url.hash}`, `${origin}/`)
}

export function getBrowserAuthOrigin() {
  return getAuthRedirectOrigin(window.location.origin)
}

function firstHeaderValue(request: Request, name: string) {
  return request.headers.get(name)?.split(",")[0]?.trim() || null
}

function originFromHost(host: string | null, protocol: string) {
  if (!host || !["http", "https"].includes(protocol)) return null

  try {
    const url = new URL(`${protocol}://${host}`)
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null
    if (["0.0.0.0", "::", "[::]"].includes(url.hostname)) return null
    return url.origin
  } catch {
    return null
  }
}
