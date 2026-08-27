export function isManagementPwaOrigin(hostname: string) {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "")
  const configuredAppHost = (process.env.NEXT_PUBLIC_RESERVEVIA_APP_DOMAIN || "app.reservevia.com").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "")
  return normalized === configuredAppHost ||
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "[::1]" ||
    normalized.endsWith(".vercel.app") ||
    normalized.endsWith(".vercel.sh")
}
