import "server-only"

import { headers } from "next/headers"
import { getPlatformOrigin } from "@/lib/platform-urls"

export async function getRequestOrigin() {
  const requestHeaders = await headers()
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim()
  const host = forwardedHost || requestHeaders.get("host")?.trim()
  if (!host) return getPlatformOrigin()

  const forwardedProtocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase()
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "http:"
    ? "http:"
    : forwardedProtocol === "https" || forwardedProtocol === "https:"
      ? "https:"
    : process.env.NODE_ENV === "production" ? "https:" : "http:"

  try {
    return new URL(`${protocol}//${host}`).origin
  } catch {
    return getPlatformOrigin()
  }
}
