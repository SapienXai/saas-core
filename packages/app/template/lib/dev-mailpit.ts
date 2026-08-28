const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

/**
 * Mailpit is a local development aid, never a production integration.
 * A configured URL is intentionally public because it points to a local inbox,
 * not to a provider credential. The production guard remains the first check.
 */
export function getDevMailpitUrl(hostname?: string | null) {
  if (process.env.NODE_ENV === "production") return null
  const configured = process.env.NEXT_PUBLIC_DEV_MAILPIT_URL?.trim()
  const fallback = LOCAL_HOSTS.has(hostname || "") ? "http://localhost:55624" : null
  const candidate = configured || fallback
  if (!candidate) return null
  try {
    const url = new URL(candidate)
    if (!["http:", "https:"].includes(url.protocol)) return null
    return url.toString().replace(/\/$/, "")
  } catch {
    return null
  }
}
