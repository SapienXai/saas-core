import { authenticateApiRequest } from "@/lib/ai/auth"
import { modifyReservation } from "@/lib/ai/reservation-management-service"
import { reservationModifySchema, apiErrorResponse, jsonApiResponse, parseApiSchema } from "@/lib/ai/contracts"
import { getIdempotencyKey, withIdempotency } from "@/lib/ai/idempotency"
import { getManagementTokenFromRequest } from "@/lib/ai/management"
import { enforceAiRateLimit, requestIdentity } from "@/lib/ai/rate-limit"
import { readJson, requestId } from "@/lib/ai/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PATCH(request: Request, { params }: { params: Promise<{ reservation_id: string }> }) {
  const id = requestId(request)
  try {
    const client = await authenticateApiRequest(request, "reservations:manage")
    await enforceAiRateLimit({ policy: "reservation_management", identity: requestIdentity(request, client.id) })
    const { reservation_id } = await params
    const body = parseApiSchema(reservationModifySchema, { ...(await readJson(request) as object), reservation_id })
    const replay = await withIdempotency({
      clientId: client.id,
      operationKind: "modify_reservation",
      idempotencyKey: getIdempotencyKey(request),
      requestBody: body,
      execute: async () => ({ status: 200, resourceId: reservation_id, body: await modifyReservation(body, getManagementTokenFromRequest(request)) }),
    })
    return jsonApiResponse(replay.body, { status: replay.status, headers: { "x-request-id": id, "cache-control": "no-store" } })
  } catch (error) {
    return apiErrorResponse(error, id)
  }
}
