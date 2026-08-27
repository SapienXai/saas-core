import { ApiDomainError, apiErrorResponse, jsonApiResponse } from "@/lib/ai/contracts"
import { getPublicRestaurantById, toPublicRestaurantDto } from "@/lib/ai/restaurant-directory"
import { getRestaurantAiReadiness } from "@/lib/ai/readiness"
import { enforceAiRateLimit, requestIdentity } from "@/lib/ai/rate-limit"
import { requestId } from "@/lib/ai/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request, { params }: { params: Promise<{ restaurant_id: string }> }) {
  const id = requestId(request)
  try {
    await enforceAiRateLimit({ policy: "restaurant_detail", identity: requestIdentity(request) })
    const { restaurant_id } = await params
    const row = await getPublicRestaurantById(restaurant_id)
    if (!row) throw new ApiDomainError("RESTAURANT_NOT_FOUND", "The published restaurant could not be found.", false, "search_restaurants", 404)
    return jsonApiResponse({
      ...toPublicRestaurantDto(row),
      description: row.description || null,
      cuisine: row.cuisine || null,
      hours: row.hours || null,
      accepts_reservations: row.reservation_enabled === true,
      ai_readiness: getRestaurantAiReadiness(row),
    }, { headers: { "x-request-id": id, "cache-control": "public, max-age=60, stale-while-revalidate=300" } })
  } catch (error) {
    return apiErrorResponse(error, id)
  }
}
