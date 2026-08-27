import "server-only"

export type AiEventName = "business_feed_request" | "restaurant_search" | "restaurant_match" | "availability_request" | "hold_created" | "hold_expired" | "reservation_attempted" | "reservation_confirmed" | "reservation_failed" | "reservation_cancelled" | "mcp_tool_invocation"

export function recordAiEvent(input: {
  event: AiEventName
  requestId?: string
  clientId?: string | null
  provider?: string | null
  tool?: string | null
  restaurantId?: string | null
  reservationId?: string | null
  latencyMs?: number
  errorCode?: string | null
}) {
  // This is intentionally an allow-listed, non-PII event shape. Never add
  // guest contact, notes, raw credentials, or management tokens here.
  console.info(JSON.stringify({
    scope: "reservevia.ai",
    event: input.event,
    request_id: input.requestId || null,
    client_id: input.clientId || null,
    provider: input.provider || null,
    tool: input.tool || null,
    restaurant_id: input.restaurantId || null,
    reservation_id: input.reservationId || null,
    latency_ms: input.latencyMs ?? null,
    error_code: input.errorCode || null,
    at: new Date().toISOString(),
  }))
}
