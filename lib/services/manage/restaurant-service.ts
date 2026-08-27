import { unstable_cache } from "next/cache"
import { createServiceRoleClient } from "@/lib/supabase"
import { PUBLIC_PROFILE_FIELDS } from "@/lib/services/public/restaurant-service"
import { toPublicRestaurantProfile } from "@/lib/restaurant-profile"
import {
  RESTAURANT_DISCOVERY_PAGE_SIZE,
  type RestaurantDiscoveryQuery,
  type RestaurantDiscoveryResult,
} from "@/lib/restaurant-discovery"

const PUBLIC_DIRECTORY_FIELDS = `${PUBLIC_PROFILE_FIELDS}, workspace_id, discovery_has_banner, discovery_has_business_email, discovery_score, remove_reservevia_branding`

type PublicDirectoryRow = Parameters<typeof toPublicRestaurantProfile>[0] & {
  id: string
  workspace_id: string | null
  discovery_has_banner: boolean
  discovery_has_business_email: boolean
  discovery_score: number
  remove_reservevia_branding: boolean
}

type RestaurantDiscoveryCursor = {
  banner: boolean
  businessEmail: boolean
  score: number
  updatedAt: string
  name: string
  id: string
}

export async function fetchManagedRestaurants(allowedRestaurantIds: string[] | null) {
  const supabase = createServiceRoleClient()

  let query = supabase
    .from("restaurants")
    .select(`
      *,
      media:restaurant_media(*)
    `)
    .order("name", { ascending: true })

  if (Array.isArray(allowedRestaurantIds)) {
    query = query.in("id", allowedRestaurantIds)
  }

  return query
}

export async function fetchPublicRestaurants() {
  try {
    const result = await fetchPublicRestaurantDirectory({ page: 1, pageSize: RESTAURANT_DISCOVERY_PAGE_SIZE })
    return { data: result.restaurants, error: null }
  } catch (error) {
    console.error("Could not load public restaurants:", error)
    return { data: [], error }
  }
}

function sanitizePostgrestSearch(value: string) {
  return value.replace(/[,%()]/g, " ").replace(/\s+/g, " ").trim()
}

function encodeRestaurantDiscoveryCursor(row: PublicDirectoryRow) {
  const cursor: RestaurantDiscoveryCursor = {
    banner: row.discovery_has_banner,
    businessEmail: row.discovery_has_business_email,
    score: row.discovery_score,
    updatedAt: row.updated_at || "1970-01-01T00:00:00.000Z",
    name: row.name,
    id: row.id,
  }
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")
}

function decodeRestaurantDiscoveryCursor(value: string | null | undefined): RestaurantDiscoveryCursor | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<RestaurantDiscoveryCursor>
    if (
      typeof parsed.banner !== "boolean" ||
      typeof parsed.businessEmail !== "boolean" ||
      typeof parsed.score !== "number" ||
      typeof parsed.updatedAt !== "string" ||
      typeof parsed.name !== "string" ||
      typeof parsed.id !== "string"
    ) return null
    return parsed as RestaurantDiscoveryCursor
  } catch {
    return null
  }
}

function mapPublicDirectoryRows(rows: PublicDirectoryRow[]) {
  return rows.map((restaurant) => toPublicRestaurantProfile(restaurant, {
    restaurantId: restaurant.id,
    showReserveviaBranding: restaurant.workspace_id ? !restaurant.remove_reservevia_branding : true,
  }))
}

function normalizeDirectoryQuery(queryInput: RestaurantDiscoveryQuery): RestaurantDiscoveryQuery {
  return {
    ...queryInput,
    page: Math.max(1, queryInput.page || 1),
    pageSize: RESTAURANT_DISCOVERY_PAGE_SIZE,
  }
}

async function fetchPublicRestaurantDirectoryUncached(queryInput: RestaurantDiscoveryQuery): Promise<RestaurantDiscoveryResult> {
  const supabase = createServiceRoleClient()
  const query = normalizeDirectoryQuery(queryInput)
  const pageSize = query.pageSize

  let resultQuery = supabase
    .from("public_restaurant_directory")
    .select(PUBLIC_DIRECTORY_FIELDS, { count: "exact" })

  const search = query.q ? sanitizePostgrestSearch(query.q) : ""
  if (search) {
    resultQuery = resultQuery.or([
      `name.ilike.%${search}%`,
      `cuisine.ilike.%${search}%`,
      `atmosphere.ilike.%${search}%`,
      `location.ilike.%${search}%`,
    ].join(","))
  }
  if (query.location) resultQuery = resultQuery.ilike("location", `%${sanitizePostgrestSearch(query.location)}%`)
  if (query.cuisine) resultQuery = resultQuery.ilike("cuisine", query.cuisine)
  if (query.atmosphere) resultQuery = resultQuery.ilike("atmosphere", `%${sanitizePostgrestSearch(query.atmosphere)}%`)

  resultQuery = resultQuery
    .order("discovery_has_banner", { ascending: false })
    .order("discovery_has_business_email", { ascending: false })
    .order("discovery_score", { ascending: false })
    .order("updated_at", { ascending: false })
    .order("name", { ascending: true })
    .order("id", { ascending: true })

  const page = query.page
  const from = (page - 1) * pageSize
  const result = await resultQuery.range(from, from + pageSize - 1)
  if (result.error) throw new Error(result.error.message)

  const total = result.count || 0
  const totalPages = total > 0 ? Math.ceil(total / pageSize) : 0
  const resolvedPage = total > 0 ? Math.min(page, totalPages) : page
  const resolvedQuery = { ...query, page: resolvedPage }
  if (total === 0) {
    return { restaurants: [], total, page: resolvedPage, pageSize, totalPages, nextCursor: null, hasMore: false, query: resolvedQuery }
  }

  const rows = (result.data || []) as PublicDirectoryRow[]
  const restaurants = mapPublicDirectoryRows(rows)
  const lastRow = rows[rows.length - 1]
  const hasMore = from + rows.length < total
  return {
    restaurants,
    total,
    page: resolvedPage,
    pageSize,
    totalPages,
    nextCursor: lastRow ? encodeRestaurantDiscoveryCursor(lastRow) : null,
    hasMore,
    query: resolvedQuery,
  }
}

const getCachedPublicRestaurantDirectory = unstable_cache(
  async (query: RestaurantDiscoveryQuery) => fetchPublicRestaurantDirectoryUncached(query),
  ["public-restaurant-directory"],
  { revalidate: 30, tags: ["public-restaurant-directory"] },
)

export async function fetchPublicRestaurantDirectory(queryInput: RestaurantDiscoveryQuery): Promise<RestaurantDiscoveryResult> {
  return getCachedPublicRestaurantDirectory(normalizeDirectoryQuery(queryInput))
}

async function fetchPublicRestaurantDiscoveryBatchUncached(queryInput: RestaurantDiscoveryQuery, cursorValue: string | null): Promise<RestaurantDiscoveryResult> {
  const supabase = createServiceRoleClient()
  const query = normalizeDirectoryQuery({ ...queryInput, page: 1 })
  const cursor = decodeRestaurantDiscoveryCursor(cursorValue)
  const { data, error } = await supabase.rpc("search_public_restaurants", {
    p_query: query.q ? sanitizePostgrestSearch(query.q) || null : null,
    p_location: query.location ? sanitizePostgrestSearch(query.location) || null : null,
    p_cuisine: query.cuisine || null,
    p_atmosphere: query.atmosphere ? sanitizePostgrestSearch(query.atmosphere) || null : null,
    p_after: cursor,
    p_limit: query.pageSize,
  })

  if (error) throw new Error(error.message)

  const payload = data as { total?: number; rows?: PublicDirectoryRow[]; hasMore?: boolean } | null
  const rows = Array.isArray(payload?.rows) ? payload.rows : []
  const total = Number(payload?.total || 0)
  const restaurants = mapPublicDirectoryRows(rows)
  const lastRow = rows[rows.length - 1]
  const nextCursor = lastRow ? encodeRestaurantDiscoveryCursor(lastRow) : null
  const hasMore = payload?.hasMore === true

  return {
    restaurants,
    total,
    page: 1,
    pageSize: query.pageSize,
    totalPages: total > 0 ? Math.ceil(total / query.pageSize) : 0,
    nextCursor,
    hasMore,
    query,
  }
}

const getCachedPublicRestaurantDiscoveryBatch = unstable_cache(
  async (query: RestaurantDiscoveryQuery, cursorValue: string | null) => fetchPublicRestaurantDiscoveryBatchUncached(query, cursorValue),
  ["public-restaurant-discovery-batch"],
  { revalidate: 30, tags: ["public-restaurant-directory"] },
)

export async function fetchPublicRestaurantDiscoveryBatch(queryInput: RestaurantDiscoveryQuery, cursorValue: string | null) {
  return getCachedPublicRestaurantDiscoveryBatch(normalizeDirectoryQuery({ ...queryInput, page: 1 }), cursorValue)
}
