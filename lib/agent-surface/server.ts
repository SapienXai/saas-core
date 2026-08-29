import "server-only"

import { getTrustedRequestHost } from "@/lib/domains/hostname"

function firstHeaderValue(request: Request, name: string) {
  return request.headers.get(name)?.split(",")[0]?.trim() || null
}

function parseOrigin(value: string | null, strict = false) {
  if (value === null || !value.trim() || value.trim().toLowerCase() === "null") return null
  try {
    const url = new URL(value)
    if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password) return null
    if (strict && (url.pathname !== "/" || url.search || url.hash)) return null
    return url.origin
  } catch {
    return null
  }
}

function getEffectiveRequestOrigin(request: Request) {
  let requestUrl: URL
  try {
    requestUrl = new URL(request.url)
  } catch {
    return null
  }

  const trustedHost = getTrustedRequestHost(request)
  if (!trustedHost) return null
  const forwardedProtocol = firstHeaderValue(request, "x-forwarded-proto")?.toLowerCase()
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "http:"
    ? "http"
    : forwardedProtocol === "https" || forwardedProtocol === "https:"
      ? "https"
      : forwardedProtocol || requestUrl.protocol.replace(":", "")
  if (!(["http", "https"].includes(protocol))) return null

  try {
    return new URL(`${protocol}://${trustedHost.host}`).origin
  } catch {
    return null
  }
}

/**
 * Checks the browser same-origin boundary for product-owned agent endpoints.
 * This is not authentication or Workspace authorization; product routes must
 * still enforce both independently.
 */
export function isSameOriginAgentRequest(request: Request) {
  const requestOrigin = getEffectiveRequestOrigin(request)
  if (!requestOrigin) return false

  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase() || null
  if (fetchSite !== null && fetchSite !== "same-origin") return false

  const originHeader = request.headers.get("origin")
  const refererHeader = request.headers.get("referer")
  if (originHeader !== null && parseOrigin(originHeader, true) !== requestOrigin) return false
  if (refererHeader !== null && parseOrigin(refererHeader) !== requestOrigin) return false

  // A context-free request is not enough evidence for an agent endpoint.
  if (originHeader === null && refererHeader === null && fetchSite !== "same-origin") return false
  return true
}
