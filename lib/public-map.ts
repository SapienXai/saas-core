import type { PublicBrandLocation } from "@/lib/services/public/brand-service"

export type PublicMapCoordinates = {
  latitude: number
  longitude: number
}

function isCoordinatePair(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude)
    && latitude >= -90
    && latitude <= 90
    && Number.isFinite(longitude)
    && longitude >= -180
    && longitude <= 180
}

function parseCoordinatePair(value: string | null | undefined): PublicMapCoordinates | null {
  if (!value) return null
  const normalized = value
    .replaceAll("\\u003d", "=")
    .replaceAll("\\u0026", "&")
    .replaceAll("&amp;", "&")
  const match = normalized.match(/(?:@|[?&#](?:q|query|ll|center)=|!3d)(-?\d+(?:\.\d+)?)(?:,|%2c|!4d)\s*(-?\d+(?:\.\d+)?)/i)
  if (!match) return null
  const latitude = Number(match[1])
  const longitude = Number(match[2])
  return isCoordinatePair(latitude, longitude) ? { latitude, longitude } : null
}

export function getPublicMapCoordinates(location: Pick<PublicBrandLocation, "latitude" | "longitude" | "locationUrl">): PublicMapCoordinates | null {
  if (typeof location.latitude === "number" && typeof location.longitude === "number" && isCoordinatePair(location.latitude, location.longitude)) {
    return { latitude: location.latitude, longitude: location.longitude }
  }
  return parseCoordinatePair(location.locationUrl)
}
