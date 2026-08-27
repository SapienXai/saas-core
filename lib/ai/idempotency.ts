import "server-only"

import { createHash } from "node:crypto"
import { ApiDomainError } from "@/lib/ai/contracts"
import { createServiceRoleClient } from "@/lib/supabase"

export function getIdempotencyKey(request: Request) {
  const key = request.headers.get("idempotency-key")?.trim()
  if (!key || key.length < 8 || key.length > 200) {
    throw new ApiDomainError("INVALID_REQUEST", "Idempotency-Key must be 8 to 200 characters.", false, "send_idempotency_key", 400)
  }
  return key
}

function requestHash(input: unknown) {
  return createHash("sha256").update(JSON.stringify(input, Object.keys(input as object || {}).sort())).digest("hex")
}

export async function withIdempotency<T>(input: {
  clientId: string
  operationKind: string
  idempotencyKey: string
  requestBody: unknown
  execute: () => Promise<{ status: number; body: T; resourceId?: string | null }>
}) {
  const hash = requestHash(input.requestBody)
  const supabase = createServiceRoleClient() as any
  const existing = await supabase.from("reservation_operation_idempotency")
    .select("request_hash, response_status, response_json, resource_id")
    .eq("api_client_id", input.clientId)
    .eq("operation_kind", input.operationKind)
    .eq("idempotency_key", input.idempotencyKey)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle()
  if (existing.error) throw new ApiDomainError("INTERNAL_ERROR", "Idempotency could not be checked.", true, "retry_request", 503)
  if (existing.data) {
    if (existing.data.request_hash !== hash) throw new ApiDomainError("IDEMPOTENCY_CONFLICT", "This idempotency key was already used for a different request.", false, "use_new_idempotency_key", 409)
    return { status: existing.data.response_status as number, body: existing.data.response_json as T, replayed: true }
  }

  const result = await input.execute()
  const inserted = await supabase.from("reservation_operation_idempotency").insert({
    api_client_id: input.clientId,
    operation_kind: input.operationKind,
    idempotency_key: input.idempotencyKey,
    request_hash: hash,
    response_status: result.status,
    response_json: result.body,
    resource_id: result.resourceId || null,
  }).select("response_status, response_json").maybeSingle()
  if (inserted.error?.code === "23505") {
    const raced = await supabase.from("reservation_operation_idempotency")
      .select("request_hash, response_status, response_json")
      .eq("api_client_id", input.clientId)
      .eq("operation_kind", input.operationKind)
      .eq("idempotency_key", input.idempotencyKey)
      .maybeSingle()
    if (raced.data?.request_hash !== hash) throw new ApiDomainError("IDEMPOTENCY_CONFLICT", "This idempotency key was already used for a different request.", false, "use_new_idempotency_key", 409)
    return { status: raced.data.response_status as number, body: raced.data.response_json as T, replayed: true }
  }
  if (inserted.error) throw new ApiDomainError("INTERNAL_ERROR", "The operation completed but could not be replay-protected.", true, "retry_request", 503)
  return { status: result.status, body: result.body, replayed: false }
}
