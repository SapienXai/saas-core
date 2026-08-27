import type { PublicBrand } from "@/lib/services/public/brand-service"

export function BrandStructuredData({ brand, canonicalUrl }: { brand: PublicBrand; canonicalUrl: string }) {
  const locations = brand.locations.map((location, index) => ({
    "@type": "ListItem",
    position: index + 1,
    item: {
      "@type": "Restaurant",
      "@id": `${canonicalUrl}#${location.slug}`,
      name: location.name,
      url: `${canonicalUrl}#${location.slug}`,
      ...(location.description ? { description: location.description } : {}),
      ...(location.primaryImageUrl ? { image: location.primaryImageUrl } : {}),
      ...(location.location ? { address: location.location } : {}),
      ...(typeof location.latitude === "number" && typeof location.longitude === "number" ? {
        geo: { "@type": "GeoCoordinates", latitude: location.latitude, longitude: location.longitude },
      } : {}),
      acceptsReservations: location.reservationEnabled,
      ...(location.reservationEnabled ? (() => {
        const reservationUrl = new URL("/reserve", canonicalUrl)
        reservationUrl.searchParams.set("restaurantSlug", location.slug)
        return { potentialAction: { "@type": "ReserveAction", target: reservationUrl.toString(), name: "Reserve a table" } }
      })() : {}),
    },
  }))

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${canonicalUrl}#brand`,
    name: brand.name,
    url: canonicalUrl,
    description: brand.description,
    ...(brand.logoUrl ? { logo: brand.logoUrl, image: brand.logoUrl } : {}),
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: `${brand.name} locations`,
      itemListElement: locations,
    },
    subjectOf: {
      "@type": "WebPage",
      "@id": canonicalUrl,
      url: canonicalUrl,
      name: `${brand.name} reservations`,
    },
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
    />
  )
}
