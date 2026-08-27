import { getBusinessFeed } from "@/lib/ai/business-feed"
import { ApiDomainError, apiErrorResponse, jsonApiResponse } from "@/lib/ai/contracts"
import { requestId } from "@/lib/ai/http"
import { recordAiEvent } from "@/lib/ai/observability"
import { enforceAiRateLimit, requestIdentity } from "@/lib/ai/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const id = requestId(request)
  const startedAt = Date.now()
  try {
    await enforceAiRateLimit({ policy: "business_feed", identity: requestIdentity(request) })
    const url = new URL(request.url)
    const pageSize = Number(url.searchParams.get("page_size") || url.searchParams.get("page_size_hint") || "100")
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new ApiDomainError("INVALID_REQUEST", "page_size must be between 1 and 1000.", false, "fix_page_size", 400)
    const result = await getBusinessFeed({ pageSize, pageToken: url.searchParams.get("page_token"), changesToken: url.searchParams.get("changes_token") })
    recordAiEvent({ event: "business_feed_request", requestId: id, provider: "openai", latencyMs: Date.now() - startedAt })
    const response = jsonApiResponse(result, { headers: { "x-request-id": id, "cache-control": "public, max-age=60, stale-while-revalidate=300", etag: `W/\"${result.checksum}\"` } })
    if (request.headers.get("if-none-match") === response.headers.get("etag")) return new Response(null, { status: 304, headers: response.headers })
    return response
  } catch (error) {
    recordAiEvent({ event: "business_feed_request", requestId: id, provider: "openai", latencyMs: Date.now() - startedAt, errorCode: error instanceof Error ? error.message : "INTERNAL_ERROR" })
    return apiErrorResponse(error instanceof Error && ["INVALID_PAGE_TOKEN", "STALE_PAGE_TOKEN", "INVALID_CHANGES_TOKEN"].includes(error.message) ? new ApiDomainError("INVALID_REQUEST", "The feed token is invalid or stale.", false, "restart_pagination", 400) : error, id)
  }
}
