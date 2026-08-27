import { authenticateApiRequest } from "@/lib/ai/auth"
import { ApiDomainError, apiErrorResponse, jsonApiResponse } from "@/lib/ai/contracts"
import { enforceAiRateLimit, requestIdentity } from "@/lib/ai/rate-limit"
import { readJson, requestId } from "@/lib/ai/http"
import { dataEngineRequestHash, ingestDataEngineBatch } from "@/lib/dataengine-reservevia"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function publicBatch(batch: any) {
  if (!batch) return null
  return {
    id: batch.id,
    external_batch_id: batch.external_batch_id,
    contract_version: batch.contract_version,
    source_run_id: batch.source_run_id,
    source_export_id: batch.source_export_id,
    source_scoring_version: batch.source_scoring_version,
    status: batch.status,
    ingest_phase: batch.ingest_phase,
    ingest_attempt_count: batch.ingest_attempt_count,
    total_leads: batch.total_leads,
    ready_leads: batch.ready_leads,
    needs_data_leads: batch.needs_data_leads,
    conflict_leads: batch.conflict_leads,
    approved_leads: batch.approved_leads,
    published_leads: batch.published_leads,
    rejected_leads: batch.rejected_leads,
    summary: batch.summary,
    created_at: batch.created_at,
    updated_at: batch.updated_at,
    reviewed_at: batch.reviewed_at,
    published_at: batch.published_at,
  }
}

function publicLead(lead: any) {
  return {
    id: lead.id,
    external_candidate_id: lead.external_candidate_id,
    readiness_status: lead.readiness_status,
    review_status: lead.review_status,
    restaurant_id: lead.restaurant_id,
    duplicate_restaurant_id: lead.duplicate_restaurant_id,
    conflict_reason: lead.conflict_reason,
    publish_status: lead.publish_status,
    publish_phase: lead.publish_phase,
    publish_attempt_count: lead.publish_attempt_count,
    banner_status: lead.banner_status,
    claimed_conflict: lead.claimed_conflict,
    staged_banner_source_type: lead.staged_banner_source_type,
    staged_banner_width: lead.staged_banner_width,
    staged_banner_height: lead.staged_banner_height,
  }
}

export async function POST(request: Request) {
  const id = requestId(request)
  try {
    const client = await authenticateApiRequest(request, "dataengine:reservevia:write")
    await enforceAiRateLimit({ policy: "dataengine_ingest", identity: requestIdentity(request, client.id) })
    const contentLength = Number(request.headers.get("content-length") || 0)
    if (contentLength > 20 * 1024 * 1024) return apiErrorResponse(new ApiDomainError("INVALID_REQUEST", "The DataEngine batch is too large.", false, "split_batch", 413), id)
    const body = await readJson<unknown>(request)
    const result = await ingestDataEngineBatch(body, client.id, dataEngineRequestHash(body))
    return jsonApiResponse({ contract_version: "reservevia.dataengine.leads.v1", request_id: id, replayed: result.replayed, batch: publicBatch(result.batch), leads: result.leads.map(publicLead) }, { status: result.replayed ? 200 : 202, headers: { "x-request-id": id, "cache-control": "no-store" } })
  } catch (error) {
    return apiErrorResponse(error, id)
  }
}
