import { availabilitySchema, ApiDomainError, apiErrorResponse, jsonApiResponse } from "@/lib/ai/contracts"
import { refreshAvailability } from "@/lib/ai/availability-service"
import { enforceAiRateLimit, requestIdentity } from "@/lib/ai/rate-limit"
import { requestId } from "@/lib/ai/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request, { params }: { params: Promise<{ restaurant_id: string }> }) {
  const id = requestId(request)
  try {
    const { restaurant_id } = await params
    const url = new URL(request.url)
    const parsed = availabilitySchema.safeParse({
      restaurant_id,
      date: url.searchParams.get("date"),
      party_size: Number(url.searchParams.get("party_size")),
      preferred_time: url.searchParams.get("preferred_time") || undefined,
      reservation_area_id: url.searchParams.get("reservation_area_id") || undefined,
    })
    if (!parsed.success) throw new ApiDomainError("INVALID_REQUEST", "Availability parameters are invalid.", false, "fix_availability_parameters", 400)
    await enforceAiRateLimit({ policy: "availability", identity: requestIdentity(request) })
    return jsonApiResponse(await refreshAvailability(parsed.data), { headers: { "x-request-id": id, "cache-control": "no-store" } })
  } catch (error) {
    return apiErrorResponse(error, id)
  }
}
