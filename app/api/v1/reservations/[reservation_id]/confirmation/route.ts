import { authenticateApiRequest } from "@/lib/ai/auth"
import { getReservationConfirmation } from "@/lib/ai/reservation-management-service"
import { apiErrorResponse, jsonApiResponse } from "@/lib/ai/contracts"
import { getManagementTokenFromRequest } from "@/lib/ai/management"
import { enforceAiRateLimit, requestIdentity } from "@/lib/ai/rate-limit"
import { requestId } from "@/lib/ai/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request, { params }: { params: Promise<{ reservation_id: string }> }) {
  const id = requestId(request)
  try {
    const client = await authenticateApiRequest(request, "reservations:manage")
    await enforceAiRateLimit({ policy: "reservation_management", identity: requestIdentity(request, client.id) })
    const { reservation_id } = await params
    return jsonApiResponse(await getReservationConfirmation(reservation_id, getManagementTokenFromRequest(request)), { headers: { "x-request-id": id, "cache-control": "no-store" } })
  } catch (error) {
    return apiErrorResponse(error, id)
  }
}
