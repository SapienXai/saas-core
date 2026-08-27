import type { PublicRestaurantProfile } from "@/lib/restaurant-profile"

export const RESTAURANT_DISCOVERY_PAGE_SIZE = 6
export const RESTAURANT_DISCOVERY_MAX_PAGE = 1000
export const RESTAURANT_DISCOVERY_MAX_FILTER_LENGTH = 80

export const RESTAURANT_DISCOVERY_PRESETS = [
  "Mediterranean",
  "Seafood",
  "Farm-to-Table",
  "Turkish Fusion",
] as const

export type RestaurantDiscoveryPreset = (typeof RESTAURANT_DISCOVERY_PRESETS)[number]

export type RestaurantDiscoveryQuery = {
  q?: string
  location?: string
  cuisine?: string
  atmosphere?: string
  page: number
  pageSize: number
}

export type RestaurantDiscoveryResult = {
  restaurants: PublicRestaurantProfile[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  nextCursor: string | null
  hasMore: boolean
  query: RestaurantDiscoveryQuery
}

export type RestaurantDiscoverySearchParams = Record<string, string | string[] | undefined>
export type RestaurantDiscoveryQueryChanges = Partial<Pick<RestaurantDiscoveryQuery, "q" | "location" | "cuisine" | "atmosphere" | "page">>

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export function normalizeDiscoveryFilter(value: unknown, maxLength = RESTAURANT_DISCOVERY_MAX_FILTER_LENGTH) {
  if (typeof value !== "string") return ""
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength)
}

function parsePage(value: string | undefined) {
  const parsed = Number.parseInt(value || "1", 10)
  if (!Number.isFinite(parsed)) return 1
  return Math.min(Math.max(parsed, 1), RESTAURANT_DISCOVERY_MAX_PAGE)
}

function normalizePreset(value: string | undefined) {
  if (!value) return ""
  return RESTAURANT_DISCOVERY_PRESETS.find((preset) => preset.toLowerCase() === value.toLowerCase()) || ""
}

export function parseRestaurantDiscoveryQuery(input: RestaurantDiscoverySearchParams = {}): RestaurantDiscoveryQuery {
  return {
    q: normalizeDiscoveryFilter(firstValue(input.q)) || undefined,
    location: normalizeDiscoveryFilter(firstValue(input.location)) || undefined,
    cuisine: normalizePreset(normalizeDiscoveryFilter(firstValue(input.cuisine))) || undefined,
    atmosphere: normalizeDiscoveryFilter(firstValue(input.atmosphere)) || undefined,
    page: parsePage(firstValue(input.page)),
    pageSize: RESTAURANT_DISCOVERY_PAGE_SIZE,
  }
}

export function buildRestaurantDiscoveryHref(query: RestaurantDiscoveryQuery, changes: RestaurantDiscoveryQueryChanges = {}) {
  const next = { ...query, ...changes }
  const params = new URLSearchParams()

  if (next.q) params.set("q", next.q)
  if (next.location) params.set("location", next.location)
  if (next.cuisine) params.set("cuisine", next.cuisine)
  if (next.atmosphere) params.set("atmosphere", next.atmosphere)
  if (next.page > 1) params.set("page", String(next.page))

  const search = params.toString()
  return search ? `/restaurants?${search}` : "/restaurants"
}

export function getRestaurantDiscoveryScore(profile: Pick<PublicRestaurantProfile, "primaryImageUrl" | "logoUrl" | "description" | "cuisine" | "atmosphere" | "hours" | "location" | "menuUrl">) {
  return [
    [profile.primaryImageUrl, 4],
    [profile.description, 2],
    [profile.logoUrl, 1],
    [profile.cuisine, 1],
    [profile.atmosphere, 1],
    [profile.hours, 1],
    [profile.location, 1],
    [profile.menuUrl, 1],
  ].reduce((score, [value, weight]) => score + (typeof value === "string" && value.trim() ? Number(weight) : 0), 0)
}
