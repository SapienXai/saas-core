import { headers } from "next/headers"
import { notFound } from "next/navigation"
import { classifyHostname } from "@/lib/domains/hostname"

async function getRequestHostname() {
  const requestHeaders = await headers()
  return requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim() || requestHeaders.get("host") || ""
}

export function isMarketingHostname(value: string) {
  const classification = classifyHostname(value)
  return ["PLATFORM_ROOT", "LOCAL_DEVELOPMENT", "VERCEL_PREVIEW"].includes(classification.kind)
}

export async function requireMarketingHost() {
  const hostname = await getRequestHostname()
  const classification = classifyHostname(hostname)
  if (!isMarketingHostname(hostname)) notFound()
  return classification
}
