export type PwaIconSize = 192 | 512

/** Resolve the product-owned, same-origin fallback icon for a manifest size. */
export function resolvePwaFallbackIconPath(iconPath: string, iconPath192: unknown, size: PwaIconSize) {
  if (size !== 192 || typeof iconPath192 !== "string") return iconPath
  const candidate = iconPath192.trim()
  return candidate.startsWith("/") && !candidate.startsWith("//") && !candidate.includes("\\")
    ? candidate
    : iconPath
}

export function getPwaIconMimeType(iconPath: string) {
  const pathname = iconPath.toLowerCase().split(/[?#]/, 1)[0]
  if (pathname.endsWith(".svg")) return "image/svg+xml"
  if (pathname.endsWith(".webp")) return "image/webp"
  return "image/png"
}
