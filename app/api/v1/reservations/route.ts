import { authenticateApiRequest } from "@/lib/ai/auth"
import { makeReservation } from "@/lib/ai/availability-service"
import { reservationCreateSchema, ApiDomainError, apiErrorResponse, jsonApiResponse, parseApiSchema } from "@/lib/ai/contracts"
import { issueCustomerManagementToken } from "@/lib/ai/management"
import { getIdempotencyKey, withIdempotency } from "@/lib/ai/idempotency"
import { enforceAiRateLimit, requestIdentity } from "@/lib/ai/rate-limit"
import { readJson, requestId } from "@/lib/ai/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const id = requestId(request)
  try {
    const client = await authenticateApiRequest(request, "reservations:write")
    await enforceAiRateLimit({ policy: "reservation_creation", identity: requestIdentity(request, client.id) })
    if (request.headers.get("x-reservevia-user-confirmed") !== "true") throw new ApiDomainError("FORBIDDEN", "User confirmation is required before creating a reservation.", false, "obtain_user_confirmation", 428)
    const body = parseApiSchema(reservationCreateSchema, await readJson(request))
    const replay = await withIdempotency({
      clientId: client.id,
      operationKind: "create_reservation",
      idempotencyKey: getIdempotencyKey(request),
      requestBody: body,
      execute: async () => {
        const reservation = await makeReservation(body, client.id)
        const management = await issueCustomerManagementToken({ reservationId: reservation.reservation_id, restaurantId: reservation.restaurant_id })
        return {
          status: 201,
          resourceId: reservation.reservation_id,
          body: {
            ...reservation,
            confirmation_url: `/api/v1/reservations/${reservation.reservation_id}/confirmation`,
            manage_url: `/api/v1/reservations/${reservation.reservation_id}/confirmation`,
            management_token: management.token,
            management_token_expires_at: management.expiresAt,
          },
        }
      },
    })
    return jsonApiResponse(replay.body, { status: replay.status, headers: { "x-request-id": id, "cache-control": "no-store" } })
  } catch (error) {
    return apiErrorResponse(error, id)
  }
}
