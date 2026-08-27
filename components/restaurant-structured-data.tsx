import type { PublicRestaurantProfile } from "@/lib/restaurant-profile"

function getReservationUrl(canonicalUrl: string, slug: string) {
  const url = new URL("/reserve", canonicalUrl)
  url.searchParams.set("restaurantSlug", slug)
  return url.toString()
}

export function RestaurantStructuredData({
  restaurant,
  canonicalUrl,
}: {
  restaurant: PublicRestaurantProfile
  canonicalUrl: string
}) {
  const description = restaurant.description?.replace(/\s+/g, " ").trim() || undefined
  const image = restaurant.primaryImageUrl || restaurant.logoUrl || undefined
  const sameAs = Object.values(restaurant.socialLinks).filter(Boolean)
  const address = restaurant.address.formatted || restaurant.location || undefined
  const postalAddress = address ? {
    "@type": "PostalAddress",
    ...(restaurant.address.line1 ? { streetAddress: restaurant.address.line1 } : {}),
    ...(restaurant.address.line2 ? { addressLine2: restaurant.address.line2 } : {}),
    ...(restaurant.address.locality ? { addressLocality: restaurant.address.locality } : {}),
    ...(restaurant.address.region ? { addressRegion: restaurant.address.region } : {}),
    ...(restaurant.address.postalCode ? { postalCode: restaurant.address.postalCode } : {}),
    ...(restaurant.address.country ? { addressCountry: restaurant.address.country } : {}),
    ...(!restaurant.address.line1 && !restaurant.address.locality ? { addressLocality: address } : {}),
  } : undefined
  const geo = typeof restaurant.latitude === "number" && typeof restaurant.longitude === "number"
    ? { "@type": "GeoCoordinates", latitude: restaurant.latitude, longitude: restaurant.longitude }
    : undefined
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    "@id": `${canonicalUrl}#restaurant`,
    name: restaurant.name,
    url: canonicalUrl,
    ...(description ? { description } : {}),
    ...(image ? { image } : {}),
    ...(restaurant.cuisine ? { servesCuisine: restaurant.cuisine } : {}),
    ...(restaurant.logoUrl ? { logo: restaurant.logoUrl } : {}),
    ...(restaurant.phone ? { telephone: restaurant.phone } : {}),
    ...(address ? { address: postalAddress } : {}),
    ...(geo ? { geo } : {}),
    ...(restaurant.locationUrl ? { hasMap: restaurant.locationUrl } : {}),
    ...(restaurant.officialWebsiteUrl ? { sameAs: [restaurant.officialWebsiteUrl, ...sameAs] } : sameAs.length > 0 ? { sameAs } : {}),
    ...(restaurant.menuUrl ? { menu: restaurant.menuUrl, hasMenu: restaurant.menuUrl } : {}),
    acceptsReservations: restaurant.reservationEnabled,
    ...(restaurant.hours ? { openingHours: restaurant.hours } : {}),
    ...(restaurant.reservationEnabled ? {
      potentialAction: {
        "@type": "ReserveAction",
        target: getReservationUrl(canonicalUrl, restaurant.slug),
        name: "Reserve a table",
      },
    } : {}),
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
      }}
    />
  )
}
