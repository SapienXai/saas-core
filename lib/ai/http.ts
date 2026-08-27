import "server-only"

import { randomUUID } from "node:crypto"
import { ApiDomainError, apiErrorResponse, jsonApiResponse } from "@/lib/ai/contracts"

export function requestId(request: Request) {
  return request.headers.get("x-request-id")?.trim().slice(0, 100) || randomUUID()
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T
  } catch {
    throw new Error("INVALID_JSON")
  }
}

export async function handleApi<T>(request: Request, handler: (requestId: string) => Promise<{ status?: number; body: T }>) {
  const id = requestId(request)
  try {
    const result = await handler(id)
    return jsonApiResponse(result.body, { status: result.status || 200, headers: { "x-request-id": id } })
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_JSON") return apiErrorResponse(new ApiDomainError("INVALID_REQUEST", "The request body must be valid JSON.", false, "fix_request_body", 400), id)
    return apiErrorResponse(error, id)
  }
}
