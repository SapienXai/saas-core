import "server-only"

import { headers } from "next/headers"
import { getTrustedHostFromHeaders, toReachableDevelopmentHostname } from "@/lib/domains/hostname"
import { getPlatformOrigin } from "@/lib/platform-urls"

export async function getRequestOrigin() {
  const requestHeaders = await headers()
  const trustedHost = getTrustedHostFromHeaders(requestHeaders)
  if (!trustedHost) return getPlatformOrigin()

  const forwardedProtocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase()
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "http:"
    ? "http:"
    : forwardedProtocol === "https" || forwardedProtocol === "https:"
      ? "https:"
    : process.env.NODE_ENV === "production" ? "https:" : "http:"

  try {
    const hostname = toReachableDevelopmentHostname(trustedHost.hostname)
    const host = hostname === trustedHost.hostname ? trustedHost.host : hostWithPort(hostname, trustedHost.host)
    return new URL(`${protocol}//${host}`).origin
  } catch {
    return getPlatformOrigin()
  }
}

function hostWithPort(hostname: string, host: string) {
  const port = new URL(`http://${host}`).port
  return `${hostname}${port ? `:${port}` : ""}`
}
