const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])
const NIP_IO_SUFFIX = ".nip.io"

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split(".")
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return false
  const [first, second] = parts.map(Number)
  return first === 10 || (first === 192 && second === 168) || (first === 172 && second >= 16 && second <= 31)
}

function isPrivateNipIoHost(hostname: string) {
  return hostname.endsWith(NIP_IO_SUFFIX) && isPrivateIpv4(hostname.slice(0, -NIP_IO_SUFFIX.length))
}

function isLocalDevelopmentHost(hostname?: string | null) {
  const normalized = hostname?.trim().toLowerCase().replace(/^\[|\]$/g, "") || ""
  return LOCAL_HOSTS.has(normalized) || normalized.endsWith(".localhost") || isPrivateIpv4(normalized) || isPrivateNipIoHost(normalized)
}

function localMailpitOrigin(hostname: string) {
  const normalized = hostname.replace(/^\[|\]$/g, "")
  const reachableHost = isPrivateIpv4(normalized) ? `${normalized}${NIP_IO_SUFFIX}` : normalized
  const host = reachableHost.includes(":") ? `[${reachableHost}]` : reachableHost
  return `http://${host}:55624`
}

/**
 * Mailpit is a local development aid, never a production integration.
 * A configured URL is intentionally public because it points to a local inbox,
 * not to a provider credential. The production guard remains the first check.
 */
export function getDevMailpitUrl(hostname?: string | null) {
  if (process.env.NODE_ENV === "production") return null
  const configured = process.env.NEXT_PUBLIC_DEV_MAILPIT_URL?.trim()
  const currentHost = hostname?.trim() || ""
  const fallback = isLocalDevelopmentHost(currentHost) ? localMailpitOrigin(currentHost) : null
  const candidate = configured || fallback
  if (!candidate) return null
  try {
    const url = new URL(candidate)
    if (!["http:", "https:"].includes(url.protocol)) return null

    // A copied .env.example commonly leaves Mailpit on localhost. When the
    // app is opened through a private LAN address, that loopback URL points
    // back to the phone/browser instead of the development machine.
    const configuredHost = url.hostname.toLowerCase().replace(/^\[|\]$/g, "")
    const currentHostNormalized = currentHost.toLowerCase().replace(/^\[|\]$/g, "")
    if (configured && fallback && LOCAL_HOSTS.has(configuredHost) && !LOCAL_HOSTS.has(currentHostNormalized)) {
      url.hostname = isPrivateIpv4(currentHostNormalized) ? `${currentHostNormalized}${NIP_IO_SUFFIX}` : currentHostNormalized
      return url.toString().replace(/\/$/, "")
    }

    return url.toString().replace(/\/$/, "")
  } catch {
    return null
  }
}
