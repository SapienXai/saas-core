import { authenticateApiRequest } from "@/lib/ai/auth"
import { createReservationHold } from "@/lib/ai/availability-service"
import { holdSchema, apiErrorResponse, jsonApiResponse, parseApiSchema } from "@/lib/ai/contracts"
import { getIdempotencyKey, withIdempotency } from "@/lib/ai/idempotency"
import { enforceAiRateLimit, requestIdentity } from "@/lib/ai/rate-limit"
import { readJson, requestId } from "@/lib/ai/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const id = requestId(request)
  try {
    const client = await authenticateApiRequest(request, "reservations:write")
    await enforceAiRateLimit({ policy: "hold_creation", identity: requestIdentity(request, client.id) })
    const body = parseApiSchema(holdSchema, await readJson(request))
    const replay = await withIdempotency({
      clientId: client.id,
      operationKind: "create_hold",
      idempotencyKey: getIdempotencyKey(request),
      requestBody: body,
      execute: async () => ({ status: 201, body: await createReservationHold(body, client.id) }),
    })
    return jsonApiResponse(replay.body, { status: replay.status, headers: { "x-request-id": id, "cache-control": "no-store" } })
  } catch (error) {
    return apiErrorResponse(error, id)
  }
}
