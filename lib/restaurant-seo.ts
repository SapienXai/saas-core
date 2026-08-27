import type { Metadata } from "next"
import { getLocaleConfig, localeConfig, type SupportedLanguage } from "@/i18n"
import type { PublicRestaurantProfile } from "@/lib/restaurant-profile"
import { withAssetVersion } from "@/lib/asset-version"

export const RESTAURANT_OG_IMAGE_SIZE = {
  width: 1200,
  height: 630,
} as const

function cleanText(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() || ""
}

export function truncateMetaText(value: string | null | undefined, maxLength: number) {
  const normalized = cleanText(value)
  if (normalized.length <= maxLength) return normalized

  const shortened = normalized
    .slice(0, Math.max(1, maxLength - 1))
    .replace(/\s+\S*$/, "")
    .trim()

  return `${shortened || normalized.slice(0, Math.max(1, maxLength - 1)).trim()}…`
}

export function getRestaurantTitle(name: string) {
  const shortName = truncateMetaText(name, 58)
  return `${shortName} | Reservevia`
}

export function getRestaurantDescription(restaurant: PublicRestaurantProfile, fallback: string) {
  return truncateMetaText(restaurant.description || fallback, 160)
}

export function getRestaurantOgImageUrl(baseUrl: string, slug?: string) {
  const path = slug
    ? `/og/restaurant/${encodeURIComponent(slug)}`
    : "/og/restaurant"
  return new URL(path, baseUrl).toString()
}

export function getRestaurantLanguageAlternates(canonical: string) {
  const languages = Object.keys(localeConfig).reduce<Record<string, string>>((result, language) => {
    const url = new URL(canonical)
    url.searchParams.set("lang", language)
    result[language] = url.toString()
    return result
  }, {})

  return { ...languages, "x-default": canonical }
}

export function buildRestaurantMetadata({
  restaurant,
  canonical,
  fallbackDescription,
  language,
}: {
  restaurant: PublicRestaurantProfile
  canonical: string
  fallbackDescription: string
  language: SupportedLanguage
}): Metadata {
  const title = getRestaurantTitle(restaurant.name)
  const description = getRestaurantDescription(restaurant, fallbackDescription)
  const imageUrl = getRestaurantOgImageUrl(canonical, restaurant.slug)
  const faviconUrl = withAssetVersion(restaurant.logoUrl || restaurant.primaryImageUrl, restaurant.updatedAt)
  const locale = getLocaleConfig(language).intl.replace("-", "_")

  return {
    title,
    description,
    keywords: [
      restaurant.name,
      restaurant.cuisine,
      restaurant.location,
      "restaurant reservations",
      "table booking",
    ].filter((value): value is string => Boolean(value?.trim())),
    alternates: {
      canonical,
      languages: getRestaurantLanguageAlternates(canonical),
    },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: "Reservevia",
      locale,
      type: "website",
      images: [{
        url: imageUrl,
        width: RESTAURANT_OG_IMAGE_SIZE.width,
        height: RESTAURANT_OG_IMAGE_SIZE.height,
        alt: `${restaurant.name} restaurant page`,
      }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [{
        url: imageUrl,
        width: RESTAURANT_OG_IMAGE_SIZE.width,
        height: RESTAURANT_OG_IMAGE_SIZE.height,
        alt: `${restaurant.name} restaurant page`,
      }],
    },
    ...(faviconUrl ? {
      icons: {
        icon: [{ url: faviconUrl }],
        apple: [{ url: faviconUrl }],
      },
    } : {}),
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
  }
}
