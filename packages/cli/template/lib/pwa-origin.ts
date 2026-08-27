export function isManagementPwaOrigin(hostname: string) {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "")
  const configuredAppHost = (process.env.NEXT_PUBLIC_SAAS_CORE_APP_DOMAIN || "app.saas-core.local").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "")
  return normalized === configuredAppHost ||
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "[::1]" ||
    normalized.endsWith(".vercel.app") ||
    normalized.endsWith(".vercel.sh")
}
