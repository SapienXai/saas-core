export const GENERIC_RESTAURANT_MEDIA_FALLBACK = "/placeholder.svg"

const LEGACY_FELIX_ASSET_PATTERN = /(?:^|\/)(?:felix\.png|beach[12]\.jpe?g|marina[12]\.jpe?g|selimiye[123]\.jpe?g)(?:[?#].*)?$/i
const LEGACY_FELIX_GARDEN_VIDEO_PATTERN = /\/garden-oRA3ycYMsw6eyb1694bRzBCKGHaF6Y\.mp4(?:[?#].*)?$/i

export function isLegacyFelixAssetUrl(value: string | null | undefined) {
  const url = value?.trim()
  return Boolean(url && (LEGACY_FELIX_ASSET_PATTERN.test(url) || LEGACY_FELIX_GARDEN_VIDEO_PATTERN.test(url)))
}

export function isValidRestaurantAssetUrl(value: string | null | undefined) {
  const url = value?.trim()
  if (!url || isLegacyFelixAssetUrl(url)) return false
  if (url.startsWith("/") && !url.startsWith("//")) return true

  try {
    const parsed = new URL(url)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

export function getSafeRestaurantAssetUrl(value: string | null | undefined, fallback: string | null = null) {
  const url = value?.trim()
  if (!url || !isValidRestaurantAssetUrl(url)) return fallback
  return url
}
