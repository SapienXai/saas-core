import { restaurantSearchSchema, ApiDomainError, apiErrorResponse, jsonApiResponse } from "@/lib/ai/contracts"
import { searchPublicRestaurants } from "@/lib/ai/restaurant-directory"
import { enforceAiRateLimit, requestIdentity } from "@/lib/ai/rate-limit"
import { requestId } from "@/lib/ai/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const id = requestId(request)
  try {
    const url = new URL(request.url)
    const parsed = restaurantSearchSchema.safeParse({
      query: url.searchParams.get("query") || undefined,
      latitude: url.searchParams.has("latitude") ? Number(url.searchParams.get("latitude")) : undefined,
      longitude: url.searchParams.has("longitude") ? Number(url.searchParams.get("longitude")) : undefined,
      radius: url.searchParams.has("radius") ? Number(url.searchParams.get("radius")) : undefined,
      locality: url.searchParams.get("locality") || undefined,
      country: url.searchParams.get("country") || undefined,
      party_size: url.searchParams.has("party_size") ? Number(url.searchParams.get("party_size")) : undefined,
      date: url.searchParams.get("date") || undefined,
      preferred_time: url.searchParams.get("preferred_time") || undefined,
      page_size: url.searchParams.has("page_size") ? Number(url.searchParams.get("page_size")) : undefined,
      page_token: url.searchParams.get("page_token") || undefined,
    })
    if (!parsed.success) throw new ApiDomainError("INVALID_REQUEST", "The restaurant search parameters are invalid.", false, "fix_search_parameters", 400)
    await enforceAiRateLimit({ policy: "restaurant_search", identity: requestIdentity(request) })
    const restaurants = await searchPublicRestaurants(parsed.data)
    return jsonApiResponse({ restaurants, next_page_token: null }, { headers: { "x-request-id": id, "cache-control": "public, max-age=30, stale-while-revalidate=120" } })
  } catch (error) {
    return apiErrorResponse(error, id)
  }
}
