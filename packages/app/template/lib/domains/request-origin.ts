import "server-only"

import { headers } from "next/headers"
import { getTrustedHostFromHeaders } from "@/lib/domains/hostname"
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
    return new URL(`${protocol}//${trustedHost.host}`).origin
  } catch {
    return getPlatformOrigin()
  }
}
