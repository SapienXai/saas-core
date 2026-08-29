import { classifyHostname } from "@/lib/domains/hostname"

export function isManagementPwaOrigin(hostname: string) {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "")
  const configuredAppHost = (process.env.NEXT_PUBLIC_SAAS_CORE_APP_DOMAIN || "app.saas-core.local").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "")
  return normalized === configuredAppHost || ["PLATFORM_APP", "LOCAL_DEVELOPMENT", "VERCEL_PREVIEW"].includes(classifyHostname(normalized).kind)
}
