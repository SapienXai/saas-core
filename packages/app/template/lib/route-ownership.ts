export const CORE_CANONICAL_APP_PATHS = [
  "/app",
  "/manage",
  "/billing/paddle/checkout",
  "/platform",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/onboarding",
  "/auth",
  "/invite",
  "/setup",
] as const

export const CORE_RESERVED_PUBLIC_PATHS = [
  "/api",
  "/_next",
  "/manifest.webmanifest",
  "/openapi.json",
  "/pwa",
  "/robots.txt",
  "/sitemap.xml",
  "/sitemaps",
  "/favicon.ico",
  "/favicon.png",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/placeholder.svg",
  "/product-mark.svg",
  "/sw.js",
] as const

function matchesPath(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`)
}

/** Normalize only URL path syntax; query and fragment never become tenant path identity. */
export function normalizeRequestPathname(value: string) {
  const raw = value.trim()
  if (!raw.startsWith("/") || raw.startsWith("//")) return null
  try { return new URL(raw, "https://saas-core.invalid").pathname || "/" } catch { return null }
}

export function isCanonicalAppPath(pathname: string) {
  const normalized = normalizeRequestPathname(pathname)
  return Boolean(normalized && CORE_CANONICAL_APP_PATHS.some((path) => matchesPath(normalized, path)))
}

export function isCoreReservedPublicPath(pathname: string) {
  const normalized = normalizeRequestPathname(pathname)
  return Boolean(normalized && CORE_RESERVED_PUBLIC_PATHS.some((path) => matchesPath(normalized, path)))
}
